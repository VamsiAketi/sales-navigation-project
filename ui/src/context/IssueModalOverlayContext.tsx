import { createContext, useContext } from "react";

const IssueModalOverlayContext = createContext(false);

/** True while `App` is showing an issue on top of a preserved background route (`IssueDetailModal`). */
export function IssueModalOverlayProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return <IssueModalOverlayContext.Provider value={value}>{children}</IssueModalOverlayContext.Provider>;
}

export function useIssueModalOverlay() {
  return useContext(IssueModalOverlayContext);
}
