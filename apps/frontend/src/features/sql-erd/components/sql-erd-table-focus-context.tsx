"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { SqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";

const SqlErdTableFocusContext = createContext<SqlErdAgentTableFocus | null>(null);

export function SqlErdTableFocusProvider({
  children,
  focus
}: {
  children: ReactNode;
  focus: SqlErdAgentTableFocus | null;
}) {
  return (
    <SqlErdTableFocusContext.Provider value={focus}>
      {children}
    </SqlErdTableFocusContext.Provider>
  );
}

export function useSqlErdTableFocus() {
  return useContext(SqlErdTableFocusContext);
}
