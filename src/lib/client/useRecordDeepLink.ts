"use client";
import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Construit l'URL avec (ou sans) ?r=<recordId>, en préservant tous les autres
 * query params (dont ?v=<viewId>). Fonction pure → testable sans navigateur.
 */
export function recordDeepLinkHref(
  pathname: string,
  currentSearch: string,
  recordId: string | null
): string {
  const params = new URLSearchParams(currentSearch);
  if (recordId) params.set("r", recordId);
  else params.delete("r");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Deep-link du RecordPanel via ?r=<recordId>. Drop-in de useState<string|null>(null) :
 * même API [value, setValue], mais adossée à l'URL (searchParams + router.replace).
 * Passer la liste COMPLÈTE des records (SWR non filtré) nettoie automatiquement un
 * ?r périmé (record supprimé / hors accès) sans erreur, et permet d'ouvrir un record
 * même filtré/hors scope de la vue (on résout sur la liste complète).
 */
export function useRecordDeepLink(
  records?: ReadonlyArray<{ id: string }>
): [string | null, (id: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedRecordId = searchParams.get("r");

  const setSelectedRecordId = useCallback(
    (id: string | null) => {
      router.replace(recordDeepLinkHref(pathname, searchParams.toString(), id));
    },
    [router, pathname, searchParams]
  );

  // Nettoyage d'un ?r périmé : records chargés mais l'id n'existe pas / plus.
  useEffect(() => {
    if (selectedRecordId && records && !records.some((r) => r.id === selectedRecordId)) {
      setSelectedRecordId(null);
    }
  }, [selectedRecordId, records, setSelectedRecordId]);

  return [selectedRecordId, setSelectedRecordId];
}
