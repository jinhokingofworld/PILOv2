export const MAX_BOARD_ISSUE_ASSIGNEES = 10;

export type AssigneeOptionsStatus = "idle" | "loading" | "success" | "error";

export type AssigneeOption = {
  avatarUrl: string | null;
  login: string;
};

type AssigneeEditSession = {
  error: null;
  status: AssigneeOptionsStatus;
};

type ToggleAssigneeResult = {
  limitReached: boolean;
  logins: string[];
};

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function uniqueLogins(logins: string[]): string[] {
  const seen = new Set<string>();
  return logins.filter((login) => {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin || seen.has(normalizedLogin)) return false;
    seen.add(normalizedLogin);
    return true;
  });
}

export function startAssigneeEditSession(
  status: AssigneeOptionsStatus
): AssigneeEditSession {
  return {
    error: null,
    status: status === "success" ? "success" : "idle"
  };
}

export function haveSameAssigneeLogins(
  left: string[],
  right: string[]
): boolean {
  const normalizedLeft = uniqueLogins(left).map(normalizeLogin).sort();
  const normalizedRight = uniqueLogins(right).map(normalizeLogin).sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((login, index) => login === normalizedRight[index])
  );
}

export function filterAssigneeOptions(
  options: AssigneeOption[],
  selectedLogins: string[],
  query: string
): AssigneeOption[] {
  const seen = new Set<string>();
  const mergedOptions: AssigneeOption[] = [];

  for (const option of options) {
    const normalizedLogin = normalizeLogin(option.login);
    if (!normalizedLogin || seen.has(normalizedLogin)) continue;
    seen.add(normalizedLogin);
    mergedOptions.push(option);
  }

  for (const login of selectedLogins) {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin || seen.has(normalizedLogin)) continue;
    seen.add(normalizedLogin);
    mergedOptions.push({ avatarUrl: null, login });
  }

  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery
    ? mergedOptions.filter((option) =>
        normalizeLogin(option.login).includes(normalizedQuery)
      )
    : mergedOptions;
}

export function toggleAssigneeLogin(
  currentLogins: string[],
  login: string,
  checked: boolean
): ToggleAssigneeResult {
  const logins = uniqueLogins(currentLogins);
  const normalizedLogin = normalizeLogin(login);

  if (!checked) {
    return {
      limitReached: false,
      logins: logins.filter(
        (selectedLogin) => normalizeLogin(selectedLogin) !== normalizedLogin
      )
    };
  }

  if (
    !normalizedLogin ||
    logins.some(
      (selectedLogin) => normalizeLogin(selectedLogin) === normalizedLogin
    )
  ) {
    return { limitReached: false, logins };
  }

  if (logins.length >= MAX_BOARD_ISSUE_ASSIGNEES) {
    return { limitReached: true, logins };
  }

  return { limitReached: false, logins: [...logins, login.trim()] };
}
