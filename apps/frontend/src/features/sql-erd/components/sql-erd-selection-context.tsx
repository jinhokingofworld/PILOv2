"use client";

import { createContext, useContext, type ReactNode } from "react";

const emptyRelationIds = new Set<string>();
const SqlErdContextRelationIdsContext =
  createContext<ReadonlySet<string>>(emptyRelationIds);

export function SqlErdSelectionContextProvider({
  children,
  relationIds
}: {
  children: ReactNode;
  relationIds: ReadonlySet<string>;
}) {
  return (
    <SqlErdContextRelationIdsContext.Provider value={relationIds}>
      {children}
    </SqlErdContextRelationIdsContext.Provider>
  );
}

export function useSqlErdContextRelationIds() {
  return useContext(SqlErdContextRelationIdsContext);
}
