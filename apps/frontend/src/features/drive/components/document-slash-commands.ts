export type SlashCommandId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "attachment";

export type SlashCommand = {
  aliases: string[];
  description: string;
  id: SlashCommandId;
  label: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "일반 문단",
    description: "기본 텍스트를 작성합니다.",
    aliases: ["문단", "텍스트", "paragraph", "text"]
  },
  {
    id: "heading1",
    label: "제목 1",
    description: "큰 제목을 작성합니다.",
    aliases: ["제목1", "h1", "heading1"]
  },
  {
    id: "heading2",
    label: "제목 2",
    description: "중간 제목을 작성합니다.",
    aliases: ["제목2", "h2", "heading2"]
  },
  {
    id: "heading3",
    label: "제목 3",
    description: "작은 제목을 작성합니다.",
    aliases: ["제목3", "h3", "heading3"]
  },
  {
    id: "bulletList",
    label: "글머리 목록",
    description: "점 목록을 만듭니다.",
    aliases: ["글머리", "불릿", "bullet", "list"]
  },
  {
    id: "orderedList",
    label: "번호 목록",
    description: "번호 목록을 만듭니다.",
    aliases: ["번호", "ordered", "numbered"]
  },
  {
    id: "blockquote",
    label: "인용",
    description: "인용 블록을 만듭니다.",
    aliases: ["인용문", "quote", "blockquote"]
  },
  {
    id: "codeBlock",
    label: "코드 블록",
    description: "코드를 작성합니다.",
    aliases: ["코드", "code", "codeblock"]
  },
  {
    id: "horizontalRule",
    label: "구분선",
    description: "문단 사이에 구분선을 넣습니다.",
    aliases: ["divider", "rule", "hr"]
  },
  {
    id: "attachment",
    label: "Drive 파일",
    description: "Workspace Drive 파일을 첨부합니다.",
    aliases: ["파일", "첨부", "attachment", "drive"]
  }
];

function normalizeSlashQuery(value: string) {
  return value.replaceAll(/\s/g, "").toLocaleLowerCase();
}

export function filterSlashCommands(commands: SlashCommand[], query: string) {
  const normalizedQuery = normalizeSlashQuery(query);

  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) =>
    [command.label, command.description, ...command.aliases].some((value) =>
      normalizeSlashQuery(value).includes(normalizedQuery)
    )
  );
}
