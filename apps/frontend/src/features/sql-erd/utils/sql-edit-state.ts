import type {
  SqltoerdDialect,
  SqltoerdLayoutJsonV1
} from "@/features/sql-erd/types";
import type { SqltoerdDdlParseError } from "@/features/sql-erd/utils/ddl-parser";
import { areSqltoerdLayoutsEqual } from "@/features/sql-erd/utils/model";
import type { SqlErdViewSession } from "@/features/sql-erd/utils/session-state";

export type SqlErdParseState = {
  error: SqltoerdDdlParseError | null;
  requestSequence: number;
  status: "error" | "idle" | "parsing";
};

export const SQL_ERD_AUTO_PARSE_DEBOUNCE_MS = 500;

export type SqlErdEditState = {
  draftDialect: SqltoerdDialect;
  draftSourceText: string;
  lastSuccessfulSnapshot: SqlErdViewSession;
  parse: SqlErdParseState;
};

export type SqlErdEditAction =
  | {
      sourceText: string;
      type: "draft_source_changed";
    }
  | {
      dialect: SqltoerdDialect;
      type: "draft_dialect_changed";
    }
  | {
      error: SqltoerdDdlParseError;
      requestSequence: number;
      type: "parse_failed";
    }
  | {
      requestSequence: number;
      type: "parse_finished";
    }
  | {
      requestLayoutJson: SqltoerdLayoutJsonV1;
      requestSequence: number;
      snapshot: SqlErdViewSession;
      type: "parse_succeeded";
    }
  | {
      snapshot: SqlErdViewSession;
      type: "session_loaded";
    }
  | {
      layoutJson: SqltoerdLayoutJsonV1;
      type: "layout_changed";
    }
  | {
      requestLayoutJson: SqltoerdLayoutJsonV1;
      snapshot: SqlErdViewSession;
      type: "layout_saved";
    }
  | {
      snapshot: SqlErdViewSession;
      type: "source_autosave_saved";
    };

export type SqlErdParseStart = {
  requestSequence: number;
  session: SqlErdViewSession;
  state: SqlErdEditState;
};

export function createSqlErdEditState(
  snapshot: SqlErdViewSession
): SqlErdEditState {
  return {
    draftDialect: snapshot.dialect,
    draftSourceText: snapshot.sourceText,
    lastSuccessfulSnapshot: snapshot,
    parse: createIdleParseState(0)
  };
}

export function beginSqlErdParse(state: SqlErdEditState): SqlErdParseStart {
  const requestSequence = state.parse.requestSequence + 1;

  return {
    requestSequence,
    session: {
      ...state.lastSuccessfulSnapshot,
      dialect: state.draftDialect,
      sourceText: state.draftSourceText
    },
    state: {
      ...state,
      parse: {
        error: null,
        requestSequence,
        status: "parsing"
      }
    }
  };
}

export function reduceSqlErdEditState(
  state: SqlErdEditState,
  action: SqlErdEditAction
): SqlErdEditState {
  if (action.type === "draft_source_changed") {
    if (action.sourceText === state.draftSourceText) {
      return state;
    }

    return {
      ...state,
      draftSourceText: action.sourceText,
      parse: createIdleParseState(state.parse.requestSequence + 1)
    };
  }

  if (action.type === "draft_dialect_changed") {
    if (action.dialect === state.draftDialect) {
      return state;
    }

    return {
      ...state,
      draftDialect: action.dialect,
      parse: createIdleParseState(state.parse.requestSequence + 1)
    };
  }

  if (action.type === "session_loaded") {
    const shouldPreserveDraft =
      state.lastSuccessfulSnapshot.id !== null &&
      state.lastSuccessfulSnapshot.id === action.snapshot.id &&
      (state.draftSourceText !== state.lastSuccessfulSnapshot.sourceText ||
        state.draftDialect !== state.lastSuccessfulSnapshot.dialect);

    return {
      draftDialect: shouldPreserveDraft
        ? state.draftDialect
        : action.snapshot.dialect,
      draftSourceText: shouldPreserveDraft
        ? state.draftSourceText
        : action.snapshot.sourceText,
      lastSuccessfulSnapshot: action.snapshot,
      parse:
        shouldPreserveDraft && state.parse.status === "error"
          ? state.parse
          : createIdleParseState(state.parse.requestSequence + 1)
    };
  }

  if (action.type === "layout_changed") {
    if (
      areSqltoerdLayoutsEqual(
        state.lastSuccessfulSnapshot.layoutJson,
        action.layoutJson
      )
    ) {
      return state;
    }

    return {
      ...state,
      lastSuccessfulSnapshot: {
        ...state.lastSuccessfulSnapshot,
        layoutJson: action.layoutJson
      }
    };
  }

  if (action.type === "layout_saved") {
    if (state.lastSuccessfulSnapshot.id !== action.snapshot.id) {
      return state;
    }

    const shouldApplySavedLayout = areSqltoerdLayoutsEqual(
      state.lastSuccessfulSnapshot.layoutJson,
      action.requestLayoutJson
    );

    return {
      ...state,
      lastSuccessfulSnapshot: {
        ...state.lastSuccessfulSnapshot,
        layoutJson: shouldApplySavedLayout
          ? action.snapshot.layoutJson
          : state.lastSuccessfulSnapshot.layoutJson,
        revision: action.snapshot.revision
      }
    };
  }

  if (action.type === "source_autosave_saved") {
    if (
      state.lastSuccessfulSnapshot.id === null ||
      state.lastSuccessfulSnapshot.id !== action.snapshot.id ||
      state.lastSuccessfulSnapshot.revision === null ||
      action.snapshot.revision === null ||
      action.snapshot.revision <= state.lastSuccessfulSnapshot.revision
    ) {
      return state;
    }

    return {
      ...state,
      lastSuccessfulSnapshot: {
        ...state.lastSuccessfulSnapshot,
        revision: action.snapshot.revision
      }
    };
  }

  if (!isSqlErdParseRequestCurrent(state, action.requestSequence)) {
    return state;
  }

  if (action.type === "parse_failed") {
    return {
      ...state,
      parse: {
        error: action.error,
        requestSequence: action.requestSequence,
        status: "error"
      }
    };
  }

  if (action.type === "parse_succeeded") {
    const shouldApplySavedLayout = areSqltoerdLayoutsEqual(
      state.lastSuccessfulSnapshot.layoutJson,
      action.requestLayoutJson
    );

    return {
      draftDialect: action.snapshot.dialect,
      draftSourceText: action.snapshot.sourceText,
      lastSuccessfulSnapshot: {
        ...action.snapshot,
        layoutJson: shouldApplySavedLayout
          ? action.snapshot.layoutJson
          : state.lastSuccessfulSnapshot.layoutJson
      },
      parse: createIdleParseState(action.requestSequence)
    };
  }

  return {
    ...state,
    parse: createIdleParseState(action.requestSequence)
  };
}

function createIdleParseState(requestSequence: number): SqlErdParseState {
  return {
    error: null,
    requestSequence,
    status: "idle"
  };
}

export function isSqlErdParseRequestCurrent(
  state: SqlErdEditState,
  requestSequence: number
) {
  return (
    state.parse.status === "parsing" &&
    state.parse.requestSequence === requestSequence
  );
}

export function isSqlErdDraftDirty(state: SqlErdEditState) {
  return (
    state.draftSourceText !== state.lastSuccessfulSnapshot.sourceText ||
    state.draftDialect !== state.lastSuccessfulSnapshot.dialect
  );
}

export function shouldScheduleSqlErdAutoParse(state: SqlErdEditState) {
  return state.parse.status === "idle" && isSqlErdDraftDirty(state);
}
