"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import {
  createDialogController,
  type DialogController,
  type DialogRequest,
} from "@/lib/client/dialogController";

export type ConfirmOptions = Omit<DialogRequest, "kind">;
export type AlertOptions = Omit<DialogRequest, "kind" | "cancelLabel">;

type DialogContextValue = {
  /** Résout à true si l'utilisateur confirme, false s'il annule (bouton, Échap, overlay). */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Notice bloquante à bouton unique (refus serveur, échec). */
  alert: (options: AlertOptions) => Promise<void>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog doit être utilisé à l'intérieur d'un <DialogProvider>");
  return ctx;
}

/**
 * Remplace window.confirm / window.alert par un dialogue aux couleurs du site.
 *
 * Une SEULE instance du modal est rendue, à la racine, via createPortal(document.body) :
 * elle échappe donc par construction aux `overflow`/`transform` des conteneurs
 * appelants (RecordPanel, colonnes kanban) et aux portails ancrés des menus.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);

  const controllerRef = useRef<DialogController | null>(null);
  if (!controllerRef.current) controllerRef.current = createDialogController(setCurrent);

  // Références STABLES : plusieurs sites d'appel les listent dans les deps de
  // leurs useCallback (KanbanView), une identité changeante les ferait churn.
  const confirm = useCallback(
    (options: ConfirmOptions) => controllerRef.current!.push({ ...options, kind: "confirm" }),
    []
  );
  const alert = useCallback(async (options: AlertOptions) => {
    await controllerRef.current!.push({ ...options, kind: "alert" });
  }, []);
  const settle = useCallback((confirmed: boolean) => controllerRef.current!.settle(confirmed), []);

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && <Dialog request={current} onSettle={settle} />}
    </DialogContext.Provider>
  );
}
