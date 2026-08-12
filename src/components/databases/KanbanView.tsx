"use client";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ChevronDown, Play, CheckCircle2, Lock } from "lucide-react";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  ParsedView,
  ParsedSprint,
  SelectOption,
  PropertyValue,
} from "@/lib/db";
import Cell, { SelectBadge, CellDisplay, UserBadge } from "@/components/databases/Cell";
import { withoutUnknownIds } from "@/lib/db";
import { applyViewConfig, deriveSeedFromFilters } from "@/lib/client/viewFilters";
import { fetcher } from "@/lib/client/fetcher";
import {
  groupValueOnDrop,
  initialGroupValue,
  mergeSeedWithGroupValue,
  cardDndId,
  parseDndId,
  shouldShowKanbanAddButton,
  buildCardProps,
  buildKanbanColumns,
} from "@/lib/client/kanban";
import type { KanbanColumn, KanbanColumnSeed } from "@/lib/client/kanban";
import { canTransition } from "@/lib/permissionRules";
import type { TransitionActor, TransitionRule } from "@/lib/permissionRules";
import { useWorkspaceMembers } from "@/lib/client/useWorkspaceMembers";
import { useDialog } from "@/contexts/DialogContext";
import Portal from "@/components/databases/portal";
import CardActions from "@/components/databases/CardActions";
import { SelectCheckbox } from "@/components/databases/SelectCheckbox";
import RecordPanel from "@/components/databases/RecordPanel";
import BulkActionBar from "@/components/databases/BulkActionBar";
import { useRecordDeepLink } from "@/lib/client/useRecordDeepLink";

// ─── Constants / types ────────────────────────────────────────────────────────

/**
 * Fenêtre pendant laquelle un clic sur le TITRE d'une carte attend un second
 * clic avant d'ouvrir le panneau. C'est le prix du double-clic pour renommer :
 * sans elle, le premier clic ouvrirait la carte et le renommage démarrerait
 * derrière un panneau déjà ouvert.
 *
 * ⚠️ Compromis assumé, dans les deux sens. Trop court, un double-clic un peu
 * lent ouvre la carte au lieu de renommer ; trop long, ouvrir une carte en
 * visant son titre devient mou. 300 ms couvre les doubles-clics usuels tout en
 * restant sous le seuil où l'attente se remarque — et le délai ne porte QUE sur
 * le titre : partout ailleurs sur la carte, l'ouverture reste immédiate.
 */
const DOUBLE_CLICK_DELAY_MS = 300;

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
  readOnly?: boolean;
  /** Espace de la database — source des membres pour les propriétés « utilisateur ». */
  workspaceId?: string;
  /** Utilisateur qui regarde — résout le jeton « Moi » des filtres. */
  currentUserId?: string;
  /** Identité + rôle, pour les règles de transition par colonne. */
  actor?: TransitionActor;
};

/**
 * Colonne calculée par `buildKanbanColumns` (pure, testée), enrichie de l'option
 * select correspondante — nécessaire au seul rendu du badge et au renommage
 * inline. `option: null` sur un axe `user` : c'est ce qui neutralise le
 * renommage, une propriété utilisateur n'ayant AUCUNE option à réécrire.
 */
type KanbanCol = KanbanColumn<ParsedRecord> & {
  option: SelectOption | null;
  /**
   * Colonne interdite à cet utilisateur (règle de transition). Porté par la
   * COLONNE et calculé une seule fois : le droppable et handleDragEnd doivent
   * lire la même valeur, sinon ils divergent — c'est exactement ce qui a imposé
   * le double garde-fou de la colonne « Membre retiré ».
   */
  locked: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colOf(cols: KanbanCol[], dndId: string): KanbanCol | null {
  const { colId } = parseDndId(dndId);
  return cols.find((c) => c.id === colId) ?? null;
}

// ─── GroupBySelector ──────────────────────────────────────────────────────────

function GroupBySelector({
  view,
  databaseId,
  properties,
}: {
  view: ParsedView;
  databaseId: string;
  properties: ParsedDatabaseProperty[];
}) {
  const eligible = properties.filter(
    (p) => p.type === "select" || p.type === "multiselect" || p.type === "user"
  );
  const [saving, setSaving] = useState(false);

  const handleSelect = async (propId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { ...view.config, groupByPropertyId: propId },
        }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <p className="text-sm text-[var(--text-muted)]">
        Choisir la propriété de regroupement
      </p>
      {eligible.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          Aucune propriété de type Sélection ou Utilisateur dans cette base.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 justify-center">
          {eligible.map((p) => (
            <button
              key={p.id}
              disabled={saving}
              onClick={() => handleSelect(p.id)}
              className="px-3 py-1.5 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)] disabled:opacity-50 transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KanbanCardContent (pure display — used by DragOverlay) ───────────────────

function KanbanCardContent({
  record,
  previewProps,
  isDragging = false,
  workspaceId,
}: {
  record: ParsedRecord;
  previewProps: ParsedDatabaseProperty[];
  isDragging?: boolean;
  workspaceId?: string;
}) {
  const visibleProps = previewProps.filter(
    (p) => record.properties[p.id] !== undefined && record.properties[p.id] !== null
  );

  return (
    <div
      className={[
        "bg-[var(--bg)] rounded-lg border border-[var(--border)] shadow-sm p-3 select-none",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <p className="text-sm font-semibold text-[var(--text)] leading-snug break-words">
        {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
      </p>
      {visibleProps.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {visibleProps.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 min-w-0 text-xs">
              <span className="shrink-0 text-[var(--text-muted)] truncate max-w-[90px]">{p.name}</span>
              <div className="min-w-0">
                <CellDisplay property={p} record={record} workspaceId={workspaceId} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KanbanCard (interactive) ─────────────────────────────────────────────────

function KanbanCard({
  record,
  colId,
  previewProps,
  autoEdit,
  selected,
  onToggleSelect,
  onTitleSave,
  onPropSave,
  onCardClick,
  onDelete,
  onDuplicate,
  readOnly,
  workspaceId,
  actor,
}: {
  record: ParsedRecord;
  /** Colonne de rendu : un record multiselect apparaît dans plusieurs colonnes. */
  colId: string;
  previewProps: ParsedDatabaseProperty[];
  autoEdit?: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onTitleSave?: (id: string, title: string) => void;
  onPropSave?: (recordId: string, property: ParsedDatabaseProperty, value: PropertyValue | null) => void;
  onCardClick?: (record: ParsedRecord) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  readOnly: boolean;
  actor?: TransitionActor;
  workspaceId?: string;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(record.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Une propriété éditée en inline (dropdown/champ ouvert). Comme isEditingTitle,
  // elle neutralise le drag & le clic d'ouverture du panneau tant qu'elle est active.
  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const isEditing = isEditingTitle || editingPropId !== null;

  useEffect(() => {
    if (autoEdit) setIsEditingTitle(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitle = () => {
    setIsEditingTitle(false);
    onTitleSave?.(record.id, titleValue.trim());
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cardDndId(colId, record.id), disabled: readOnly });

  // Après un drag, dnd-kit émet un clic parasite : on l'ignore brièvement pour ne
  // pas entrer en édition de titre juste après un dépôt.
  const justDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      justDraggedRef.current = true;
      return;
    }
    if (justDraggedRef.current) {
      const t = setTimeout(() => { justDraggedRef.current = false; }, 60);
      return () => clearTimeout(t);
    }
  }, [isDragging]);

  // Le titre départage le clic simple (ouvrir la carte) du double (renommer).
  // ⚠️ Un double-clic émet DEUX `click` AVANT le `dblclick` : sans ce report,
  // le premier ouvrirait déjà le panneau et le renommage démarrerait derrière
  // lui. On attend donc un éventuel second clic — et seulement sur le titre :
  // partout ailleurs sur la carte, l'ouverture reste immédiate.
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    },
    []
  );

  const handleTitleClick = (e: React.MouseEvent) => {
    // Le clic ne remonte jamais à la carte : c'est ici qu'on arbitre.
    e.stopPropagation();
    if (justDraggedRef.current) return;

    // `detail` compte les clics du geste en cours : 2 = second clic d'un double.
    // Il arrive avant `dblclick`, donc l'ouverture est annulée à temps — c'est
    // ce qui permet de tout traiter dans un seul handler.
    if (e.detail >= 2) {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      setIsEditingTitle(true);
      return;
    }

    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      onCardClick?.(record);
    }, DOUBLE_CLICK_DELAY_MS);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isEditing || readOnly ? {} : listeners)}
      onClick={() => {
        if (!isEditing) onCardClick?.(record);
      }}
      className={`group ${isEditing ? "" : "cursor-pointer"}`}
    >
      <div
        className={[
          "bg-[var(--bg)] rounded-lg border shadow-sm p-3 select-none relative transition-colors",
          isDragging
            ? "opacity-40 border-[var(--border)]"
            : selected
              ? "border-[var(--accent)]"
              : "border-[var(--border)] hover:border-[var(--accent)]",
        ].join(" ")}
      >
        {/* Case de sélection : visible au survol OU quand la carte est cochée.
            Contrôle distinct du clic d'ouverture / du drag (stopPropagation).
            ⚠️ Sous md, l'état masqué est VISIBLE : sans survol, la case restait
            invisible mais tapable — on basculait une sélection sans avoir vu de
            case. Au-dessus de md le comportement historique est conservé : une
            souris révèle avant de cliquer. */}
        {!isEditing && !readOnly && (
          <SelectCheckbox
            selected={selected}
            onToggle={onToggleSelect}
            label="Sélectionner la carte"
            className={[
              "grid absolute top-1 left-1 z-10",
              selected
                ? "opacity-100"
                : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
            ].join(" ")}
          />
        )}

        {/* Actions directes (dupliquer / supprimer), visibles au survol. */}
        {!readOnly && (
          <CardActions
            className="absolute top-1.5 right-1.5"
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        )}

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            data-card-title-input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
              if (e.key === "Escape") { e.preventDefault(); setIsEditingTitle(false); }
            }}
            // iOS Safari zoome sur tout champ sous 16px et ne dézoome pas au blur.
            className="w-full text-base sm:text-sm font-semibold bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          // DOUBLE-clic sur le titre → édition inline ; clic simple → ouvre la
          // carte, comme partout ailleurs sur elle. Le simple clic renommait
          // jusqu'au 09/08/2026 : viser le titre pour ouvrir une carte faisait
          // entrer en édition sans l'avoir demandé.
          // En lecture seule, aucun handler : le clic remonte à la carte et
          // l'ouvre SANS délai — il n'y a pas de renommage à départager.
          <p
            // Gouttières réservées aux deux affordances désormais toujours
            // visibles sous md (case de sélection à gauche, actions à droite) :
            // sans elles, le titre passerait dessous.
            className={[
              "text-sm font-semibold text-[var(--text)] leading-snug break-words pr-14 md:pr-12",
              readOnly ? "" : "pl-7 md:pl-5 cursor-text",
            ].join(" ")}
            onClick={readOnly ? undefined : handleTitleClick}
            // Un double-clic ne se devine pas : on le dit au survol.
            title={readOnly ? undefined : "Double-cliquer pour renommer"}
          >
            {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
          </p>
        )}
        {previewProps.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {previewProps.map((p) => (
              // Le stopPropagation est porté par la VALEUR seule (le wrapper Cell) :
              // cliquer la valeur ENTRE en édition, mais cliquer le libellé ou l'espace
              // vide de la ligne laisse remonter le clic → ouvre le panneau / drag carte.
              <div key={p.id} className="flex items-center gap-1.5 min-w-0 text-xs">
                <span className="shrink-0 text-[var(--text-muted)] truncate max-w-[90px]" title={p.name}>
                  {p.name}
                </span>
                {readOnly ? (
                  <div className="min-w-0 max-w-full">
                    <CellDisplay property={p} record={record} workspaceId={workspaceId} />
                  </div>
                ) : (
                  <div
                    className="min-w-0 max-w-full"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Cell
                      property={p}
                      record={record}
                      workspaceId={workspaceId}
                      actor={actor}
                      onSave={(value) => onPropSave?.(record.id, p, value)}
                      onEditingChange={(editing) =>
                        setEditingPropId((prev) => (editing ? p.id : prev === p.id ? null : prev))
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

export function KanbanColView({
  col,
  previewProps,
  onAddRecord,
  newRecordId,
  selectedIds,
  onToggleSelect,
  onTitleSave,
  onPropSave,
  onCardClick,
  onDeleteRecord,
  onDuplicateRecord,
  onRenameOption,
  createOnlyInUnassigned,
  readOnly = false,
  workspaceId,
  actor,
}: {
  col: KanbanCol;
  previewProps: ParsedDatabaseProperty[];
  onAddRecord: (col: KanbanCol) => void;
  newRecordId: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onTitleSave: (id: string, title: string) => void;
  onPropSave: (recordId: string, property: ParsedDatabaseProperty, value: PropertyValue | null) => void;
  onCardClick: (record: ParsedRecord) => void;
  onDeleteRecord: (record: ParsedRecord) => void;
  onDuplicateRecord: (record: ParsedRecord) => void;
  onRenameOption: (optionId: string, newName: string) => void;
  createOnlyInUnassigned: boolean;
  readOnly?: boolean;
  workspaceId?: string;
  actor?: TransitionActor;
}) {
  // La colonne « Membre retiré » n'est PAS une cible de dépôt : son optionId est
  // null, y déposer une carte appliquerait la sémantique « Sans valeur » et
  // effacerait tous ses assignés.
  const { setNodeRef, isOver } = useDroppable({
    id: col.id,
    disabled: col.kind === "orphan" || col.locked,
  });

  const [isRenamingCol, setIsRenamingCol] = useState(false);
  const [colNameValue, setColNameValue] = useState(col.label);
  const colNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenamingCol) setColNameValue(col.label);
  }, [col.label, isRenamingCol]);

  useEffect(() => {
    if (isRenamingCol) {
      colNameInputRef.current?.focus();
      colNameInputRef.current?.select();
    }
  }, [isRenamingCol]);

  const commitRename = () => {
    setIsRenamingCol(false);
    const trimmed = colNameValue.trim();
    if (!trimmed || trimmed === col.label || col.optionId === null) return;
    onRenameOption(col.optionId, trimmed);
  };

  return (
    // Sous md la colonne prend presque tout l'écran et s'aligne sur le scroll-snap
    // du board : sans ça, on lit en permanence deux demi-colonnes. `max-w` évite
    // qu'une tablette de 760px hérite d'une colonne de 640px.
    // `snap-start` est inerte au-dessus de md, le board y repassant en `snap-none`.
    // `data-kanban-column` est la prise des tests E2E. Ils ciblaient `div.w-64`,
    // donc une classe de PRÉSENTATION : la première largeur responsive posée ici
    // a fait tomber sept specs d'un coup, sans qu'aucun comportement ne change.
    <div
      data-kanban-column
      className="w-[85vw] max-w-[18rem] md:w-64 md:max-w-none shrink-0 snap-start flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 px-1 min-h-[28px]">
        {col.option ? (
          isRenamingCol ? (
            <input
              ref={colNameInputRef}
              value={colNameValue}
              onChange={(e) => setColNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsRenamingCol(false);
                  setColNameValue(col.label);
                }
              }}
              className="text-base sm:text-sm font-medium bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)] min-w-0 max-w-[160px]"
              style={{ width: Math.max(60, colNameValue.length * 8) + "px" }}
            />
          ) : (
            <span
              className={readOnly ? "" : "cursor-text"}
              onClick={readOnly ? undefined : () => setIsRenamingCol(true)}
              title={readOnly ? undefined : "Cliquer pour renommer"}
            >
              <SelectBadge option={col.option} />
            </span>
          )
        ) : col.kind === "seed" ? (
          // Axe « assigné » : pastille de membre, et AUCUN renommage — il n'y a
          // pas d'option à réécrire, le PATCH serait sans objet.
          <UserBadge userId={col.id} displayName={col.label} />
        ) : col.kind === "orphan" ? (
          <UserBadge userId={col.id} />
        ) : (
          <span className="text-sm font-medium text-[var(--text-muted)]">Sans valeur</span>
        )}
        {col.locked && (
          <Lock
            size={12}
            className="text-[var(--text-muted)] shrink-0"
            aria-label="Colonne verrouillée"
          />
        )}
        <span className="text-xs text-[var(--text-muted)] ml-auto tabular-nums">
          {col.records.length}
        </span>
        {/* Bouton d'ajout ANCRÉ en tête de colonne : reste visible même quand la
            lane déborde (le board scrolle globalement, pas la lane). Le flag ne
            change QUE l'affichage, jamais la position. */}
        {!readOnly && col.kind !== "orphan" && !col.locked &&
          shouldShowKanbanAddButton(createOnlyInUnassigned, col.optionId) && (
          <button
            onClick={() => onAddRecord(col)}
            className="shrink-0 flex items-center gap-1 pl-1 pr-1.5 py-2 md:py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded-md transition-colors"
            title="Nouvel enregistrement"
          >
            <Plus size={13} />
            Nouveau
          </button>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={[
          "flex flex-col gap-2 min-h-[60px] rounded-lg p-1 transition-colors",
          isOver ? "bg-[var(--surface)]" : "",
        ].join(" ")}
      >
        <SortableContext
          items={col.records.map((r) => cardDndId(col.id, r.id))}
          strategy={verticalListSortingStrategy}
        >
          {col.records.map((record) => (
            <KanbanCard
              key={record.id}
              record={record}
              colId={col.id}
              previewProps={previewProps}
              autoEdit={record.id === newRecordId}
              selected={selectedIds.has(record.id)}
              onToggleSelect={() => onToggleSelect(record.id)}
              onTitleSave={onTitleSave}
              onPropSave={onPropSave}
              onCardClick={onCardClick}
              onDelete={() => onDeleteRecord(record)}
              onDuplicate={() => onDuplicateRecord(record)}
              readOnly={readOnly}
              workspaceId={workspaceId}
              actor={actor}
            />
          ))}
          {col.records.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center py-4 select-none pointer-events-none">
              Aucun enregistrement
            </p>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

// ─── SprintBoardHeader (board scopé à un sprint) ──────────────────────────────

function SprintBoardHeader({
  sprints, scope, targetSprint, onScopeChange, onStart, onComplete, readOnly = false,
}: {
  sprints: ParsedSprint[];
  scope: string;
  targetSprint: ParsedSprint | null;
  onScopeChange: (scope: string) => void;
  onStart: () => void;
  onComplete: () => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const stateLabel = (s: ParsedSprint) =>
    s.state === "active" ? "actif" : s.state === "completed" ? "terminé" : "à venir";

  const label =
    scope === "all"
      ? "Toutes les issues"
      : scope === "active"
        ? targetSprint ? targetSprint.name : "Sprint actif"
        : targetSprint ? targetSprint.name : "Sprint";

  // Lecture seule : le sélecteur PATCHe le config partagé et démarrer/terminer
  // sont des mutations → on n'affiche que le libellé du scope courant.
  if (readOnly) {
    return (
      <div className="flex flex-wrap md:flex-nowrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <span className="px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]">
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap md:flex-nowrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
      >
        {label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <Portal anchor={btnRef} onClose={() => setOpen(false)} minWidth={210}>
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)]"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange("active"); }}
          >
            Sprint actif
          </button>
          {sprints.map((s) => (
            <button
              key={s.id}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange(s.id); }}
            >
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-xs text-[var(--text-muted)] shrink-0">{stateLabel(s)}</span>
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)] border-t border-[var(--border)]"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange("all"); }}
          >
            Toutes les issues
          </button>
        </Portal>
      )}

      {targetSprint?.state === "future" && (
        <button
          onClick={onStart}
          className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Play size={14} /> Démarrer
        </button>
      )}
      {targetSprint?.state === "active" && (
        <button
          onClick={onComplete}
          className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
        >
          <CheckCircle2 size={14} /> Terminer le sprint
        </button>
      )}
    </div>
  );
}

// ─── KanbanView (main) ────────────────────────────────────────────────────────

export default function KanbanView({
  databaseId, view, properties, readOnly = false, workspaceId, currentUserId, actor,
}: Props) {
  const { confirm, alert } = useDialog();
  const {
    data: records,
    error,
    isLoading,
    mutate,
  } = useSWR<ParsedRecord[]>(`/api/databases/${databaseId}/records`, fetcher);

  // Board « sprint-aware » : ne fetch les sprints QUE si la vue est scopée
  // (kanban classique → key null → aucune requête, comportement inchangé).
  const sprintScope = view.config.sprintScope;
  const { data: sprints, mutate: mutateSprints } = useSWR<ParsedSprint[]>(
    sprintScope ? `/api/databases/${databaseId}/sprints` : null,
    fetcher
  );
  const targetSprint = useMemo(() => {
    if (!sprintScope || sprintScope === "all") return null;
    const list = sprints ?? [];
    if (sprintScope === "active") return list.find((s) => s.state === "active") ?? null;
    return list.find((s) => s.id === sprintScope) ?? null;
  }, [sprintScope, sprints]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [newRecordId, setNewRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useRecordDeepLink(records);

  // ── Sélection multiple (éphémère, propre à cette vue) ────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [view.id]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const pendingIds = useRef<Set<string>>(new Set());
  const pendingTitles = useRef<Map<string, string>>(new Map());
  const newRecordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragJustEndedRef = useRef(false);

  // ⚠️ PointerSensor + distance ne s'arme quasiment jamais au doigt : le
  // navigateur revendique le geste pour le scroll et émet `pointercancel`. Le
  // `delay` du TouchSensor est ce qui distingue l'appui long (« je déplace ») du
  // glissement (« je scrolle ») — c'est la carte ENTIÈRE qui porte les
  // listeners ici, donc pas de `touch-none` : il gèlerait le scroll du board.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  const groupByPropId = (view.config as { groupByPropertyId?: string }).groupByPropertyId;
  const groupByProp = groupByPropId
    ? properties.find((p) => p.id === groupByPropId)
    : undefined;

  const displayedRecords = useMemo(() => {
    if (!records) return [];
    let scoped: ParsedRecord[] = records;
    if (sprintScope && sprintScope !== "all") {
      scoped = targetSprint ? records.filter((r) => r.sprintId === targetSprint.id) : [];
    }
    const byPosition = [...scoped].sort((a, b) => a.position - b.position);
    return applyViewConfig(byPosition, view.config, properties, currentUserId);
  }, [records, sprintScope, targetSprint, view.config, properties, currentUserId]);

  // Axe « assigné » : les colonnes sont les MEMBRES de l'espace, pas des options
  // (une propriété user n'en a pas). Clé SWR nulle sur les autres axes → aucun
  // fetch sur un kanban classique.
  const groupsByUser = groupByProp?.type === "user";
  const {
    members,
    isLoading: membersLoading,
    error: membersError,
  } = useWorkspaceMembers(groupsByUser ? workspaceId : null);
  const memberIds = useMemo(() => members.map((m) => m.userId), [members]);

  // Règles de transition de l'axe de regroupement (absentes sur les 22 boards
  // existants → `locked` vaut false partout, comportement inchangé).
  const rules = (groupByProp?.config as { rules?: TransitionRule[] } | undefined)?.rules;

  const columns = useMemo<KanbanCol[]>(() => {
    if (!groupByProp) return [];
    const options = (groupByProp.config as { options?: SelectOption[] }).options ?? [];
    const seeds: KanbanColumnSeed[] = groupsByUser
      ? members.map((m) => ({ id: m.userId, label: m.displayName }))
      : options.map((o) => ({ id: o.id, label: o.name }));

    const byId = new Map(options.map((o) => [o.id, o] as const));
    return buildKanbanColumns(
      displayedRecords,
      groupByProp.id,
      groupByProp.type,
      seeds,
      // Seul l'axe user peut porter un id orphelin : un membre part sans garde-fou,
      // là où le serveur refuse de retirer une option select encore référencée.
      // ⚠️ JAMAIS pendant le chargement des membres : `seeds` serait vide et TOUTE
      // carte assignée serait déclarée orpheline (le rendu est gardé plus bas,
      // ceci est la seconde ceinture).
      { includeOrphans: groupsByUser && !membersLoading, orphanLabel: "Membre retiré" }
    ).map((col) => ({
      ...col,
      option: col.optionId ? byId.get(col.optionId) ?? null : null,
      locked: !canTransition(rules, null, col.optionId, actor),
    }));
  }, [displayedRecords, groupByProp, groupsByUser, members, membersLoading, rules, actor]);

  // Propriétés affichées/éditables sur la carte : top-2 par position + « Main à » et
  // « Projet » garanties (présence non soumise au slice(0,2)).
  const previewProps = useMemo(
    () => buildCardProps(properties, groupByPropId),
    [properties, groupByPropId]
  );

  // activeId est un id composite « colonne::record » → extraire le record.
  const activeRecord = useMemo(
    () => (activeId ? records?.find((r) => r.id === parseDndId(activeId).recordId) ?? null : null),
    [records, activeId]
  );

  // ── Card click → open panel ─────────────────────────────────────────────────

  const handleCardClick = useCallback((record: ParsedRecord) => {
    if (dragJustEndedRef.current) return;
    setSelectedRecordId(record.id);
  }, []);

  // ── Title save ──────────────────────────────────────────────────────────────

  const handleTitleSave = useCallback(
    (recordId: string, title: string) => {
      if (!records) return;

      if (pendingIds.current.has(recordId)) {
        pendingTitles.current.set(recordId, title);
        mutate(
          records.map((r) => r.id === recordId ? { ...r, title } : r),
          { revalidate: false }
        );
        return;
      }

      const snapshot = records;
      mutate(records.map((r) => r.id === recordId ? { ...r, title } : r), { revalidate: false });
      fetch(`/api/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => { mutate(snapshot, { revalidate: false }); });
    },
    [records, mutate]
  );

  // ── Property save (inline sur la carte) ─────────────────────────────────────
  // Même contrat que TableView.handleSave, restreint aux propriétés (le titre a
  // son propre chemin) : optimistic + rollback, une valeur null retire la clé.

  const handlePropSave = useCallback(
    (recordId: string, property: ParsedDatabaseProperty, value: PropertyValue | null) => {
      if (!records) return;
      // Record temporaire (création en vol) : pas encore d'id serveur → on ignore.
      if (pendingIds.current.has(recordId)) return;

      const snapshot = records;
      const optimistic = records.map((r) => {
        if (r.id !== recordId) return r;
        const props = { ...r.properties };
        if (value === null) delete props[property.id];
        else props[property.id] = value;
        return { ...r, properties: props };
      });
      mutate(optimistic, { revalidate: false });

      fetch(`/api/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { [property.id]: value } }),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => { mutate(snapshot, { revalidate: false }); });
    },
    [records, mutate]
  );

  // ── Delete record ───────────────────────────────────────────────────────────

  const handleDeleteRecord = useCallback(
    async (record: ParsedRecord) => {
      if (!records) return;
      const ok = await confirm({
        title: "Supprimer cet enregistrement ?",
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!ok) return;
      if (selectedRecordId === record.id) setSelectedRecordId(null);
      setSelectedIds((prev) => {
        if (!prev.has(record.id)) return prev;
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
      const snapshot = records;
      mutate(records.filter((r) => r.id !== record.id), { revalidate: false });
      try {
        const res = await fetch(`/api/records/${record.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        mutate();
      } catch {
        mutate(snapshot, { revalidate: false });
      }
    },
    [records, mutate, selectedRecordId, confirm]
  );

  // ── Duplicate record ────────────────────────────────────────────────────────

  const handleDuplicateRecord = useCallback(
    async (record: ParsedRecord) => {
      try {
        const res = await fetch(`/api/records/${record.id}/duplicate`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        mutate();
      } catch (err) {
        console.error("Échec de la duplication", err);
      }
    },
    [mutate]
  );

  // ── Rename select option (column header) ────────────────────────────────────

  const handleRenameOption = useCallback(
    async (optionId: string, newName: string) => {
      if (!groupByProp) return;
      // Un nom vide est refusé par la validation serveur (400) : ne rien envoyer.
      const trimmed = newName.trim();
      if (!trimmed) return;
      const config = groupByProp.config as { type: string; options?: SelectOption[] };
      const options = config.options ?? [];
      const updatedConfig = {
        ...config,
        options: options.map((o) => o.id === optionId ? { ...o, name: trimmed } : o),
      };
      try {
        const res = await fetch(`/api/properties/${groupByProp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: updatedConfig }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        globalMutate(`/api/databases/${databaseId}`);
      } catch (err) {
        console.error("Échec du renommage de la colonne", err);
      }
    },
    [groupByProp, databaseId]
  );

  // ── Add record (optimistic) ─────────────────────────────────────────────────

  const handleAddRecord = useCallback(
    async (col: KanbanCol) => {
      if (!groupByPropId || !groupByProp) return;

      const tempId = crypto.randomUUID();
      const now = new Date();
      const lastPos = col.records.length > 0
        ? Math.max(...col.records.map((r) => r.position))
        : (records ?? []).reduce((max, r) => Math.max(max, r.position), 0);

      // string (select) ou tableau d'un id (multiselect) ; null = « Sans valeur ».
      const initValue = initialGroupValue(groupByProp.type, col.optionId);
      // Pré-remplissage dérivé des filtres eq (select/text) de la vue : la carte
      // satisfait le filtre par construction et ne disparaît pas après revalidation.
      // La valeur d'axe (groupBy) PRIME sur un filtre visant la même propriété.
      const seed = deriveSeedFromFilters(view.config.filters ?? [], properties, currentUserId);
      const initProperties = mergeSeedWithGroupValue(seed, groupByPropId, initValue);

      const tempRecord: ParsedRecord = {
        id: tempId,
        databaseId,
        title: "",
        icon: null,
        coverUrl: null,
        content: "[]",
        templateId: null,
        sectionsBody: null,
        trashedAt: null,
        sprintId: targetSprint?.id ?? null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        position: lastPos + 1000,
        properties: initProperties,
      };

      pendingIds.current.add(tempId);
      mutate((prev) => [...(prev ?? []), tempRecord], { revalidate: false });
      setNewRecordId(tempId);

      try {
        const body: Record<string, unknown> = {};
        if (Object.keys(initProperties).length > 0) body.properties = initProperties;
        if (targetSprint) body.sprintId = targetSprint.id;

        const res = await fetch(`/api/databases/${databaseId}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created: ParsedRecord = await res.json();

        pendingIds.current.delete(tempId);
        const bufferedTitle = pendingTitles.current.get(tempId);
        pendingTitles.current.delete(tempId);

        const realRecord = bufferedTitle ? { ...created, title: bufferedTitle } : created;
        setNewRecordId(created.id);
        mutate(
          (prev) => (prev ?? []).map((r) => r.id === tempId ? realRecord : r),
          { revalidate: false }
        );

        if (newRecordTimer.current) clearTimeout(newRecordTimer.current);
        newRecordTimer.current = setTimeout(() => setNewRecordId(null), 500);

        if (bufferedTitle) {
          fetch(`/api/records/${created.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: bufferedTitle }),
          })
            .then(() => mutate())
            .catch(() => mutate());
        } else {
          mutate();
        }
      } catch (err) {
        pendingIds.current.delete(tempId);
        pendingTitles.current.delete(tempId);
        setNewRecordId(null);
        mutate((prev) => (prev ?? []).filter((r) => r.id !== tempId), { revalidate: false });
        console.error("Échec de la création du record (kanban)", err);
      }
    },
    [databaseId, groupByPropId, groupByProp, records, mutate, targetSprint, view.config.filters, properties]
  );

  // ── Drag start ──────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  // ── Drag end ────────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      dragJustEndedRef.current = true;
      setTimeout(() => { dragJustEndedRef.current = false; }, 50);

      const { active, over } = event;
      if (!over || !records || !groupByPropId || !groupByProp) return;

      const activeDndId = active.id as string;
      const overId = over.id as string;
      if (activeDndId === overId) return;

      // Ids composites « colonne::record » → la colonne source est celle DEPUIS
      // laquelle on glisse (déterminant en multiselect, où la carte est dans
      // plusieurs colonnes), pas la première qui contient le record.
      const activeRecordId = parseDndId(activeDndId).recordId;
      if (!activeRecordId) return;
      const overRecordId = parseDndId(overId).recordId;

      const sourceCol = colOf(columns, activeDndId);
      const targetCol = colOf(columns, overId);
      if (!sourceCol || !targetCol) return;
      // `disabled` sur le droppable ne couvre PAS un dépôt sur une CARTE de la
      // colonne orpheline (elle reste un item sortable). Sans ce garde-fou, le
      // drop y appliquerait la sémantique « Sans valeur » (optionId null) et
      // effacerait tous les assignés de la carte déplacée.
      if (targetCol.kind === "orphan") return;
      // Même raison, même remède, pour une colonne verrouillée par une règle :
      // le droppable désactivé ne bloque pas un dépôt sur l'une de ses CARTES.
      // Le serveur refuserait en 403, mais l'optimisme aurait déjà fait bouger
      // la carte — un aller-retour visuel que l'utilisateur lit comme un bug.
      if (targetCol.locked) return;

      const targetRecords = targetCol.records.filter((r) => r.id !== activeRecordId);
      const overIsColumn = overRecordId === null;
      const insertIndex = overIsColumn
        ? targetRecords.length
        : Math.max(0, targetRecords.findIndex((r) => r.id === overRecordId));

      const prev = targetRecords[insertIndex - 1];
      const next = targetRecords[insertIndex];
      let newPosition: number;
      if (!prev && !next) newPosition = 1000;
      else if (!prev) newPosition = next.position / 2;
      else if (!next) newPosition = prev.position + 1000;
      else newPosition = (prev.position + next.position) / 2;

      const isNewColumn = sourceCol.id !== targetCol.id;

      // Valeur d'axe après le drop : string (select) ou TABLEAU d'ids (multiselect).
      // null = retirer la clé (colonne « Sans valeur »).
      const activeRecord = records.find((r) => r.id === activeRecordId);
      const dropped = isNewColumn
        ? groupValueOnDrop(
            groupByProp.type,
            activeRecord?.properties[groupByPropId],
            sourceCol.optionId,
            targetCol.optionId
          )
        : null;
      // Un assigné parti reste dans la valeur de la carte ; le réémettre ferait
      // refuser TOUT le tableau (400 de validateUserValues) et la carte serait
      // indéplaçable — c'est justement celle qu'on vient sortir de la colonne
      // « Membre retiré ». Le lien mort est donc lâché au premier déplacement.
      const nextGroupValue = groupsByUser ? withoutUnknownIds(dropped, memberIds) : dropped;

      const snapshot = records;
      const optimistic = records.map((r) => {
        if (r.id !== activeRecordId) return r;
        const props = { ...r.properties };
        if (isNewColumn) {
          if (nextGroupValue === null) delete props[groupByPropId];
          else props[groupByPropId] = nextGroupValue;
        }
        return { ...r, position: newPosition, properties: props };
      });
      mutate(optimistic, { revalidate: false });

      const patchBody: Record<string, unknown> = { position: newPosition };
      if (isNewColumn) {
        patchBody.properties = { [groupByPropId]: nextGroupValue };
      }

      fetch(`/api/records/${activeRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          mutate();
        })
        .catch(() => {
          mutate(snapshot, { revalidate: false });
        });
    },
    [columns, records, groupByPropId, groupByProp, groupsByUser, memberIds, mutate]
  );

  // ── Sprint board : scope + démarrer / terminer ─────────────────────────────

  const handleScopeChange = useCallback(
    async (scope: string) => {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...view.config, sprintScope: scope } }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    },
    [view.id, view.config, databaseId]
  );

  const handleStartSprint = useCallback(async () => {
    if (!targetSprint) return;
    const res = await fetch(`/api/sprints/${targetSprint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "active" }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      await alert({
        title: "Démarrage impossible",
        message: (b as { error?: string }).error ?? "Échec du démarrage.",
        tone: "danger",
      });
      return;
    }
    mutateSprints();
  }, [targetSprint, mutateSprints, alert]);

  const handleCompleteSprint = useCallback(async () => {
    if (!targetSprint) return;
    // Non destructif : les issues non terminées retournent au backlog, rien n'est perdu.
    const ok = await confirm({
      title: "Terminer le sprint ?",
      message: "Les issues non terminées retournent au backlog.",
      confirmLabel: "Terminer",
    });
    if (!ok) return;
    const res = await fetch(`/api/sprints/${targetSprint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: "completed",
        moveIncompleteToBacklog: true,
        statusPropertyId: groupByPropId,
        ...(view.config.doneStatusOptionId && { doneStatusOptionId: view.config.doneStatusOptionId }),
      }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      await alert({
        title: "Clôture impossible",
        message: (b as { error?: string }).error ?? "Échec de la clôture.",
        tone: "danger",
      });
      return;
    }
    mutateSprints();
    mutate(); // des records ont changé de sprint (incomplètes → backlog)
  }, [targetSprint, groupByPropId, view.config.doneStatusOptionId, mutateSprints, mutate, confirm, alert]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Chargement…
      </div>
    );
  }

  if (error || !records) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        Impossible de charger les enregistrements.
      </div>
    );
  }

  // Axe « assigné » : sans la liste des membres, il n'y a AUCUNE colonne à
  // dessiner. Peindre quand même afficherait un board faux — toutes les cartes
  // assignées regroupées sous « Membre retiré » — puis le réorganiserait sous le
  // curseur à l'arrivée de la réponse.
  if (groupsByUser && membersLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Chargement des membres…
      </div>
    );
  }

  if (groupsByUser && membersError) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        Impossible de charger les membres de l&apos;espace.
      </div>
    );
  }

  if (!groupByProp) {
    // Le sélecteur PATCHe le config partagé de la vue → message statique en RO.
    if (readOnly) {
      return (
        <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
          Vue kanban non configurée.
        </div>
      );
    }
    return (
      <GroupBySelector
        view={view}
        databaseId={databaseId}
        properties={properties}
      />
    );
  }

  const selectedRecord = selectedRecordId
    ? records.find((r) => r.id === selectedRecordId) ?? null
    : null;

  const scopedEmpty = !!sprintScope && sprintScope !== "all" && !targetSprint;

  return (
    <div className="flex flex-col h-full">
      {sprintScope && (
        <SprintBoardHeader
          sprints={sprints ?? []}
          scope={sprintScope}
          targetSprint={targetSprint}
          onScopeChange={handleScopeChange}
          onStart={handleStartSprint}
          onComplete={handleCompleteSprint}
          readOnly={readOnly}
        />
      )}

      {scopedEmpty ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1.5 text-[var(--text-muted)]">
          <p className="text-sm">Aucun sprint actif.</p>
          <p className="text-xs">Démarre un sprint depuis la vue Backlog, ou choisis-en un ci-dessus.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* `scroll-px-4` conserve la gouttière du board une fois la colonne
              accrochée (sans lui, le padding gauche disparaît sous le snap). */}
          <div className="flex gap-4 p-4 overflow-x-auto flex-1 snap-x snap-mandatory scroll-px-4 md:snap-none md:scroll-px-0">
            {columns.map((col) => (
              <KanbanColView
                key={col.id}
                col={col}
                previewProps={previewProps}
                onAddRecord={handleAddRecord}
                newRecordId={newRecordId}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onTitleSave={handleTitleSave}
                onPropSave={handlePropSave}
                onCardClick={handleCardClick}
                onDeleteRecord={handleDeleteRecord}
                onDuplicateRecord={handleDuplicateRecord}
                onRenameOption={handleRenameOption}
                createOnlyInUnassigned={view.config.createInUnassignedOnly ?? false}
                readOnly={readOnly}
                workspaceId={workspaceId}
                actor={actor}
              />
            ))}
          </div>

          <DragOverlay>
            {activeRecord ? (
              <div className="cursor-grabbing shadow-xl">
                <KanbanCardContent record={activeRecord} previewProps={previewProps} workspaceId={workspaceId} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {selectedRecord && (
        <RecordPanel
          key={selectedRecord.id}
          record={selectedRecord}
          properties={properties}
          databaseId={databaseId}
          workspaceId={workspaceId}
          actor={actor}
          onClose={() => setSelectedRecordId(null)}
          readOnly={readOnly}
        />
      )}

      {/* Barre d'action groupée (sélection multiple) — jamais montée en RO */}
      {!readOnly && (
        <BulkActionBar
          properties={properties}
          records={records}
          selectedIds={selectedIds}
          mutate={mutate}
          onClear={clearSelection}
          workspaceId={workspaceId}
          actor={actor}
        />
      )}
    </div>
  );
}
