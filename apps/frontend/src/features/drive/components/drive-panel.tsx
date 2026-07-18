"use client";

import {
  AlertCircle,
  ChevronRight,
  Download,
  FileText,
  FilePlus,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth";
import {
  createDriveApiClient,
  uploadDriveFileToPresignedUrl
} from "@/features/drive/api/client";
import { DriveWorkspaceLocationAdapter } from "@/features/drive/drive-workspace-location-adapter";
import type { DriveItem, DriveListPayload } from "@/features/drive/types";
import { cn } from "@/lib/utils";

import { DriveDocumentEditor } from "./document-editor";
import { PdfPreviewDialog } from "./pdf-preview-dialog";

type DriveStatus = "idle" | "loading" | "success" | "error";

type DriveUploadState =
  | {
      status: "idle";
    }
  | {
      status: "uploading";
      fileName: string;
      progressPercent: number | null;
    }
  | {
      status: "success";
      fileName: string;
    }
  | {
      status: "error";
      fileName: string;
      message: string;
    };

const emptyDriveData: DriveListPayload = {
  parent: null,
  breadcrumbs: [],
  items: []
};

const DRIVE_NAME_MAX_LENGTH = 255;
const MAX_DRIVE_FILE_SIZE_BYTES = 104857600;
const FALLBACK_MIME_TYPE = "application/octet-stream";

function errorMessageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "파일 목록을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function validateDriveItemName(value: string) {
  const name = value.trim();

  if (!name) {
    return { error: "이름을 입력해주세요.", name };
  }

  if (name.length > DRIVE_NAME_MAX_LENGTH) {
    return { error: "이름은 255자 이하로 입력해주세요.", name };
  }

  if (name === "." || name === "..") {
    return { error: "사용할 수 없는 이름입니다.", name };
  }

  if (/[\\/]/.test(name)) {
    return { error: "이름에는 / 또는 \\를 사용할 수 없습니다.", name };
  }

  return { error: null, name };
}

function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) {
    return "-";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getItemTypeLabel(item: DriveItem) {
  if (item.itemType === "folder") {
    return "폴더";
  }

  if (item.itemType === "document") {
    return "문서";
  }

  return item.mimeType || "파일";
}

function getItemActorLabel(item: DriveItem) {
  return item.updatedByUser?.name ?? item.createdByUser?.name ?? "알 수 없음";
}

function getFileMimeType(file: File) {
  return file.type.trim() || FALLBACK_MIME_TYPE;
}

function triggerBrowserDownload(downloadUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function DriveBreadcrumbs({
  breadcrumbs,
  currentParentId,
  onNavigate
}: {
  breadcrumbs: DriveItem[];
  currentParentId: string | null;
  onNavigate: (parentId: string | null) => void;
}) {
  return (
    <nav
      aria-label="파일 경로"
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-current={currentParentId === null ? "page" : undefined}
        className="shrink-0"
        onClick={() => onNavigate(null)}
      >
        <Home />
        루트
      </Button>

      {breadcrumbs.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-current={currentParentId === item.id ? "page" : undefined}
            className="min-w-0"
            onClick={() => onNavigate(item.id)}
          >
            <span className="truncate">{item.name}</span>
          </Button>
        </div>
      ))}
    </nav>
  );
}

function DriveItemName({ item }: { item: DriveItem }) {
  const isFolder = item.itemType === "folder";
  const isDocument = item.itemType === "document";

  return (
    <>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          isFolder
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : isDocument
              ? "border-violet-200 bg-violet-50 text-violet-700"
              : "border-sky-200 bg-sky-50 text-sky-700"
        )}
      >
        {isFolder ? (
          <Folder className="size-4" />
        ) : (
          <FileText className="size-4" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
          {getItemTypeLabel(item)} · {formatFileSize(item.sizeBytes)}
        </span>
      </span>
    </>
  );
}

function DriveItemRow({
  activeActionItemId,
  item,
  onDownload,
  onOpenDelete,
  onOpenDocument,
  onOpenFolder,
  onOpenMove,
  onOpenPdf,
  onOpenRename
}: {
  activeActionItemId: string | null;
  item: DriveItem;
  onDownload: (item: DriveItem) => void;
  onOpenDelete: (item: DriveItem) => void;
  onOpenDocument: (item: DriveItem) => void;
  onOpenFolder: (item: DriveItem) => void;
  onOpenMove: (item: DriveItem) => void;
  onOpenPdf: (item: DriveItem) => void;
  onOpenRename: (item: DriveItem) => void;
}) {
  const isFolder = item.itemType === "folder";
  const isDocument = item.itemType === "document";
  const isPdf = item.itemType === "file" && item.mimeType === "application/pdf";
  const isOpenable = isFolder || isDocument || isPdf;
  const isBusy = activeActionItemId === item.id;

  return (
    <li
      className={cn(
        "grid gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)_3rem] md:items-center",
        isOpenable && "transition hover:bg-muted/40"
      )}
    >
      {isOpenable ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (isFolder) {
              onOpenFolder(item);
              return;
            }

            if (isDocument) {
              onOpenDocument(item);
              return;
            }

            onOpenPdf(item);
          }}
        >
          <DriveItemName item={item} />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 text-left">
          <DriveItemName item={item} />
        </div>
      )}

      <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
        {getItemTypeLabel(item)}
      </span>
      <span className="hidden text-sm text-muted-foreground md:block">
        {formatFileSize(item.sizeBytes)}
      </span>
      <span className="min-w-0 text-xs text-muted-foreground md:text-sm">
        <span className="block truncate">{formatDateTime(item.updatedAt)}</span>
        <span className="block truncate md:hidden">
          {getItemActorLabel(item)}
        </span>
      </span>
      <div className="flex items-center justify-start md:justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${item.name} 작업`}
                disabled={isBusy}
              />
            }
          >
            {isBusy ? (
              <Loader2 className="animate-spin" />
            ) : (
              <MoreHorizontal />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              {item.itemType === "file" ? (
                <DropdownMenuItem
                  className="gap-2"
                  disabled={isBusy}
                  onClick={() => onDownload(item)}
                >
                  <Download />
                  다운로드
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="gap-2"
                disabled={isBusy}
                onClick={() => onOpenRename(item)}
              >
                <Pencil />
                이름 변경
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                disabled={isBusy}
                onClick={() => onOpenMove(item)}
              >
                <FolderInput />
                이동
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2"
                disabled={isBusy}
                variant="destructive"
                onClick={() => onOpenDelete(item)}
              >
                <Trash2 />
                삭제
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function DriveListSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)_3rem]"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3 md:hidden" />
            </div>
          </div>
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="size-7" />
        </div>
      ))}
    </div>
  );
}

function DriveUploadNotice({
  onDismiss,
  uploadState
}: {
  onDismiss: () => void;
  uploadState: DriveUploadState;
}) {
  if (uploadState.status === "idle") {
    return null;
  }

  const isUploading = uploadState.status === "uploading";
  const isError = uploadState.status === "error";
  const progressPercent =
    uploadState.status === "uploading" ? uploadState.progressPercent : null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        isError
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "bg-muted/30"
      )}
      role={isError ? "alert" : "status"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {isUploading
              ? "업로드 중"
              : isError
                ? "업로드 실패"
                : "업로드 완료"}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate",
              isError ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {uploadState.fileName}
            {isError ? ` · ${uploadState.message}` : null}
          </p>
        </div>
        {!isUploading ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="업로드 알림 닫기"
            onClick={onDismiss}
          >
            <X className="size-4" />
          </Button>
        ) : (
          <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {isUploading ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent ?? 8}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function CreateFolderSheet({
  currentFolderName,
  error,
  isOpen,
  isSubmitting,
  name,
  onNameChange,
  onOpenChange,
  onSubmit
}: {
  currentFolderName: string;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <SheetHeader>
            <SheetTitle>새 폴더</SheetTitle>
            <SheetDescription>{currentFolderName}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 px-4">
            <label className="grid gap-1.5 text-sm font-medium">
              이름
              <Input
                value={name}
                maxLength={DRIVE_NAME_MAX_LENGTH}
                placeholder="폴더 이름"
                disabled={isSubmitting}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <SheetFooter className="border-t">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FolderPlus />
                )}
                만들기
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RenameItemSheet({
  error,
  isSubmitting,
  item,
  name,
  onNameChange,
  onOpenChange,
  onSubmit
}: {
  error: string | null;
  isSubmitting: boolean;
  item: DriveItem | null;
  name: string;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <SheetHeader>
            <SheetTitle>이름 변경</SheetTitle>
            <SheetDescription>
              {item?.itemType === "folder" ? "폴더" : "파일"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 px-4">
            <label className="grid gap-1.5 text-sm font-medium">
              이름
              <Input
                value={name}
                maxLength={DRIVE_NAME_MAX_LENGTH}
                placeholder="새 이름"
                disabled={isSubmitting}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <SheetFooter className="border-t">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Pencil />
                )}
                저장
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MoveItemSheet({
  destination,
  destinationParentId,
  error,
  hasDestinationError,
  isDestinationReady,
  isLoading,
  isSubmitting,
  item,
  onNavigate,
  onOpenChange,
  onRetry,
  onSelect
}: {
  destination: DriveListPayload;
  destinationParentId: string | null;
  error: string | null;
  hasDestinationError: boolean;
  isDestinationReady: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  item: DriveItem | null;
  onNavigate: (parentId: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onSelect: (parentId: string | null) => void;
}) {
  const folders = destination.items.filter((candidate) => candidate.itemType === "folder");
  const isCurrentParent = item?.parentId === destinationParentId;
  const isInvalidDestination = destinationParentId === item?.id;
  const canSelect =
    Boolean(item) &&
    !isCurrentParent &&
    !isInvalidDestination &&
    isDestinationReady &&
    !isLoading &&
    !isSubmitting;
  const destinationLabel = destination.parent?.name ?? "루트";

  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>이동</SheetTitle>
            <SheetDescription>
              {item ? `${item.name}의 이동할 폴더를 선택하세요.` : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            <DriveBreadcrumbs
              breadcrumbs={destination.breadcrumbs}
              currentParentId={destinationParentId}
              onNavigate={onNavigate}
            />

            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">선택한 위치</p>
              <p className="mt-1 truncate text-sm font-medium">{destinationLabel}</p>
            </div>

            {error ? (
              <p
                className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : hasDestinationError ? (
              <div className="flex min-h-24 flex-col items-start justify-center gap-3 px-2">
                <p className="text-sm text-muted-foreground">
                  폴더 목록을 다시 불러온 뒤 이동할 수 있습니다.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={onRetry}
                >
                  <RefreshCw />
                  다시 시도
                </Button>
              </div>
            ) : (
              <div className="grid gap-1">
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  하위 폴더
                </p>
                {folders.length ? (
                  folders.map((folder) => {
                    const isMovingFolder = folder.id === item?.id;

                    return (
                      <Button
                        key={folder.id}
                        type="button"
                        variant="ghost"
                        className="justify-between gap-3 px-2"
                        disabled={isSubmitting || isMovingFolder}
                        onClick={() => onNavigate(folder.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Folder className="size-4 shrink-0 text-amber-700" />
                          <span className="truncate">{folder.name}</span>
                        </span>
                        {isMovingFolder ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            이동할 폴더
                          </span>
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                      </Button>
                    );
                  })
                ) : (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    이동할 하위 폴더가 없습니다.
                  </p>
                )}
              </div>
            )}
          </div>

          <SheetFooter className="border-t">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!canSelect}
                onClick={() => onSelect(destinationParentId)}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : <FolderInput />}
                {isCurrentParent ? "현재 위치" : "이 폴더로 이동"}
              </Button>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeleteItemDialog({
  error,
  isDeleting,
  item,
  onConfirm,
  onOpenChange
}: {
  error: string | null;
  isDeleting: boolean;
  item: DriveItem | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 className="size-5" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {item?.itemType === "folder" ? "폴더 삭제" : "파일 삭제"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {item?.itemType === "folder"
              ? "폴더와 하위 항목이 모두 삭제됩니다."
              : "삭제한 파일은 목록에서 사라집니다."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border bg-muted/30 p-3">
          <p className="break-words text-sm font-medium">{item?.name}</p>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DrivePanel() {
  const authSession = useAuthSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const driveListRef = useRef<HTMLDivElement | null>(null);
  const loadedDriveParentIdRef = useRef<{
    folderId: string | null;
    workspaceId: string;
  } | null>(null);
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const workspaceName = authSession?.activeWorkspace.name ?? "Workspace";
  const normalizedAccessToken = authSession?.accessToken.trim() ?? "";
  const canUseDrive = Boolean(workspaceId.trim() && normalizedAccessToken);
  const documentId = searchParams.get("documentId");
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [driveData, setDriveData] = useState<DriveListPayload>(emptyDriveData);
  const [status, setStatus] = useState<DriveStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeActionItemId, setActiveActionItemId] = useState<string | null>(
    null
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [uploadState, setUploadState] = useState<DriveUploadState>({
    status: "idle"
  });
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [moveItem, setMoveItem] = useState<DriveItem | null>(null);
  const [moveDestinationParentId, setMoveDestinationParentId] = useState<
    string | null
  >(null);
  const [moveDestinationData, setMoveDestinationData] =
    useState<DriveListPayload>(emptyDriveData);
  const [moveDestinationStatus, setMoveDestinationStatus] =
    useState<DriveStatus>("idle");
  const [moveDestinationRequestVersion, setMoveDestinationRequestVersion] =
    useState(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const itemCountLabel = useMemo(() => {
    const folderCount = driveData.items.filter(
      (item) => item.itemType === "folder"
    ).length;
    const documentCount = driveData.items.filter(
      (item) => item.itemType === "document"
    ).length;
    const fileCount = driveData.items.length - folderCount - documentCount;

    return `폴더 ${folderCount}개 · 문서 ${documentCount}개 · 파일 ${fileCount}개`;
  }, [driveData.items]);
  const currentFolderName = driveData.parent
    ? driveData.parent.name
    : `${workspaceName} 루트`;
  const isUploading = uploadState.status === "uploading";

  const fetchDriveData = useCallback(async () => {
    if (!canUseDrive) {
      return emptyDriveData;
    }

    return driveClient.listItems(workspaceId, {
      parentId: currentParentId
    });
  }, [canUseDrive, currentParentId, driveClient, workspaceId]);

  const loadWorkspaceLocationFolder = useCallback(
    async (folderId: string | null) => {
      if (!canUseDrive) {
        return false;
      }

      try {
        const nextDriveData = await driveClient.listItems(workspaceId, {
          parentId: folderId
        });
        loadedDriveParentIdRef.current = { folderId, workspaceId };
        setCurrentParentId(folderId);
        setDriveData(nextDriveData);
        setStatus("success");
        setError(null);
        return true;
      } catch {
        return false;
      }
    },
    [canUseDrive, driveClient, workspaceId]
  );

  const reloadDrive = useCallback(async () => {
    if (!canUseDrive) {
      setDriveData(emptyDriveData);
      setStatus("idle");
      setError(null);
      return emptyDriveData;
    }

    setStatus("loading");
    setError(null);

    try {
      const nextDriveData = await fetchDriveData();
      loadedDriveParentIdRef.current = {
        folderId: currentParentId,
        workspaceId
      };
      setDriveData(nextDriveData);
      setStatus("success");
      return nextDriveData;
    } catch (loadError) {
      const nextError =
        loadError instanceof Error
          ? loadError
          : new Error("파일 목록을 불러오지 못했습니다.");
      setDriveData(emptyDriveData);
      setError(nextError);
      setStatus("error");
      return emptyDriveData;
    }
  }, [canUseDrive, currentParentId, fetchDriveData, workspaceId]);

  useEffect(() => {
    let active = true;

    async function loadDrive() {
      if (!canUseDrive) {
        loadedDriveParentIdRef.current = null;
        setDriveData(emptyDriveData);
        setStatus("idle");
        setError(null);
        return;
      }

      if (
        loadedDriveParentIdRef.current?.workspaceId === workspaceId &&
        loadedDriveParentIdRef.current.folderId === currentParentId
      ) {
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const nextDriveData = await fetchDriveData();
        if (!active) return;

        loadedDriveParentIdRef.current = {
          folderId: currentParentId,
          workspaceId
        };
        setDriveData(nextDriveData);
        setStatus("success");
      } catch (loadError) {
        if (!active) return;

        const nextError =
          loadError instanceof Error
            ? loadError
            : new Error("파일 목록을 불러오지 못했습니다.");
        setDriveData(emptyDriveData);
        setError(nextError);
        setStatus("error");
      }
    }

    void loadDrive();

    return () => {
      active = false;
    };
  }, [canUseDrive, currentParentId, fetchDriveData, workspaceId]);

  useEffect(() => {
    if (!moveItem) {
      return;
    }

    if (!canUseDrive) {
      setMoveDestinationData(emptyDriveData);
      setMoveDestinationStatus("idle");
      setMoveError("파일을 이동하려면 로그인이 필요합니다.");
      return;
    }

    let active = true;

    async function loadMoveDestination() {
      setMoveDestinationStatus("loading");
      setMoveError(null);

      try {
        const nextDestination = await driveClient.listItems(workspaceId, {
          parentId: moveDestinationParentId
        });
        if (!active) return;

        setMoveDestinationData(nextDestination);
        setMoveDestinationStatus("success");
      } catch (moveLoadError) {
        if (!active) return;

        setMoveDestinationData(emptyDriveData);
        setMoveDestinationStatus("error");
        setMoveError(errorMessageFromUnknown(moveLoadError));
      }
    }

    void loadMoveDestination();

    return () => {
      active = false;
    };
  }, [
    canUseDrive,
    driveClient,
    moveDestinationParentId,
    moveDestinationRequestVersion,
    moveItem,
    workspaceId
  ]);

  function openCreateFolderSheet() {
    setFolderName("");
    setFolderError(null);
    setIsCreateOpen(true);
  }

  function updateDocumentLocation(nextDocumentId: string | null) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());

    if (nextDocumentId) {
      nextSearchParams.set("documentId", nextDocumentId);
    } else {
      nextSearchParams.delete("documentId");
    }

    const search = nextSearchParams.toString();
    router.push(search ? `/files?${search}` : "/files");
  }

  async function handleCreateDocument() {
    if (!canUseDrive) {
      setActionError("문서를 만들려면 로그인이 필요합니다.");
      return;
    }

    setActionError(null);
    setActiveActionItemId("create-document");

    try {
      const result = await driveClient.createDocument(workspaceId, {
        parentId: currentParentId
      });
      await reloadDrive();
      updateDocumentLocation(result.document.id);
    } catch (createError) {
      setActionError(errorMessageFromUnknown(createError));
    } finally {
      setActiveActionItemId(null);
    }
  }

  function handleCreateOpenChange(open: boolean) {
    if (isCreatingFolder) {
      return;
    }

    setIsCreateOpen(open);

    if (!open) {
      setFolderName("");
      setFolderError(null);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canUseDrive) {
      setFolderError("폴더를 만들려면 로그인이 필요합니다.");
      return;
    }

    const result = validateDriveItemName(folderName);
    if (result.error) {
      setFolderError(result.error);
      return;
    }

    setIsCreatingFolder(true);
    setFolderError(null);

    try {
      await driveClient.createFolder(workspaceId, {
        parentId: currentParentId,
        name: result.name
      });
      setIsCreateOpen(false);
      setFolderName("");
      await reloadDrive();
    } catch (createError) {
      setFolderError(errorMessageFromUnknown(createError));
    } finally {
      setIsCreatingFolder(false);
    }
  }

  function openFilePicker() {
    setActionError(null);
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    if (!canUseDrive) {
      setUploadState({
        status: "error",
        fileName: file.name,
        message: "파일을 업로드하려면 로그인이 필요합니다."
      });
      return;
    }

    const nameResult = validateDriveItemName(file.name);
    if (nameResult.error) {
      setUploadState({
        status: "error",
        fileName: file.name,
        message: nameResult.error
      });
      return;
    }

    if (file.size > MAX_DRIVE_FILE_SIZE_BYTES) {
      setUploadState({
        status: "error",
        fileName: file.name,
        message: "파일은 100 MiB 이하만 업로드할 수 있습니다."
      });
      return;
    }

    setActionError(null);
    setUploadState({
      status: "uploading",
      fileName: file.name,
      progressPercent: null
    });

    try {
      const result = await driveClient.createUploadUrl(workspaceId, {
        parentId: currentParentId,
        name: nameResult.name,
        sizeBytes: file.size,
        mimeType: getFileMimeType(file)
      });

      await uploadDriveFileToPresignedUrl({
        file,
        headers: result.upload.headers,
        uploadUrl: result.upload.uploadUrl,
        onProgress: (progress) => {
          setUploadState({
            status: "uploading",
            fileName: file.name,
            progressPercent: progress.percent
          });
        }
      });

      await driveClient.completeUpload(workspaceId, result.file.id, {
        uploadId: result.upload.id
      });

      setUploadState({
        status: "success",
        fileName: file.name
      });
      await reloadDrive();
    } catch (uploadError) {
      setUploadState({
        status: "error",
        fileName: file.name,
        message: errorMessageFromUnknown(uploadError)
      });
      void reloadDrive();
    }
  }

  async function handleDownloadItem(item: DriveItem) {
    if (item.itemType !== "file") {
      return;
    }

    if (!canUseDrive) {
      setActionError("파일을 다운로드하려면 로그인이 필요합니다.");
      return;
    }

    setActiveActionItemId(item.id);
    setActionError(null);

    try {
      const result = await driveClient.createDownloadUrl(workspaceId, item.id);
      triggerBrowserDownload(result.downloadUrl, item.name);
    } catch (downloadError) {
      setActionError(errorMessageFromUnknown(downloadError));
    } finally {
      setActiveActionItemId(null);
    }
  }

  function openMoveSheet(item: DriveItem) {
    setMoveItem(item);
    setMoveDestinationParentId(item.parentId);
    setMoveDestinationData(emptyDriveData);
    setMoveDestinationStatus("idle");
    setMoveError(null);
    setActionError(null);
  }

  function handleMoveOpenChange(open: boolean) {
    if (isMoving) {
      return;
    }

    if (!open) {
      setMoveItem(null);
      setMoveDestinationParentId(null);
      setMoveDestinationData(emptyDriveData);
      setMoveDestinationStatus("idle");
      setMoveError(null);
    }
  }

  function navigateMoveDestination(parentId: string | null) {
    if (moveItem?.itemType === "folder" && parentId === moveItem.id) {
      return;
    }

    setMoveDestinationParentId(parentId);
  }

  async function handleMoveSelect(parentId: string | null) {
    if (!moveItem) {
      return;
    }

    if (!canUseDrive) {
      setMoveError("파일을 이동하려면 로그인이 필요합니다.");
      return;
    }

    if (moveItem.parentId === parentId) {
      setMoveError("이미 이 폴더에 있습니다.");
      return;
    }

    if (moveItem.itemType === "folder" && parentId === moveItem.id) {
      setMoveError("폴더를 자기 자신으로 이동할 수 없습니다.");
      return;
    }

    setIsMoving(true);
    setActiveActionItemId(moveItem.id);
    setMoveError(null);

    try {
      await driveClient.updateItem(workspaceId, moveItem.id, { parentId });
      setMoveItem(null);
      setMoveDestinationData(emptyDriveData);
      setMoveDestinationStatus("idle");
      await reloadDrive();
    } catch (moveErrorValue) {
      setMoveError(errorMessageFromUnknown(moveErrorValue));
    } finally {
      setIsMoving(false);
      setActiveActionItemId(null);
    }
  }

  function openRenameSheet(item: DriveItem) {
    setRenameItem(item);
    setRenameName(item.name);
    setRenameError(null);
    setActionError(null);
  }

  function handleRenameOpenChange(open: boolean) {
    if (isRenaming) {
      return;
    }

    if (!open) {
      setRenameItem(null);
      setRenameName("");
      setRenameError(null);
    }
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!renameItem) {
      return;
    }

    if (!canUseDrive) {
      setRenameError("이름을 변경하려면 로그인이 필요합니다.");
      return;
    }

    const result = validateDriveItemName(renameName);
    if (result.error) {
      setRenameError(result.error);
      return;
    }

    setIsRenaming(true);
    setActiveActionItemId(renameItem.id);
    setRenameError(null);

    try {
      await driveClient.updateItem(workspaceId, renameItem.id, {
        name: result.name
      });
      setRenameItem(null);
      setRenameName("");
      await reloadDrive();
    } catch (renameErrorValue) {
      setRenameError(errorMessageFromUnknown(renameErrorValue));
    } finally {
      setIsRenaming(false);
      setActiveActionItemId(null);
    }
  }

  function openDeleteDialog(item: DriveItem) {
    setDeleteItem(item);
    setDeleteError(null);
    setActionError(null);
  }

  function handleDeleteOpenChange(open: boolean) {
    if (isDeleting) {
      return;
    }

    if (!open) {
      setDeleteItem(null);
      setDeleteError(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteItem) {
      return;
    }

    if (!canUseDrive) {
      setDeleteError("삭제하려면 로그인이 필요합니다.");
      return;
    }

    setIsDeleting(true);
    setActiveActionItemId(deleteItem.id);
    setDeleteError(null);

    try {
      await driveClient.deleteItem(workspaceId, deleteItem.id);
      setDeleteItem(null);
      await reloadDrive();
    } catch (deleteErrorValue) {
      setDeleteError(errorMessageFromUnknown(deleteErrorValue));
    } finally {
      setIsDeleting(false);
      setActiveActionItemId(null);
    }
  }

  if (documentId) {
    return (
      <DriveDocumentEditor
        documentId={documentId}
        onClose={() => updateDocumentLocation(null)}
      />
    );
  }

  const isLoading = status === "loading";
  const isEmpty = status === "success" && driveData.items.length === 0;

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col gap-4">
      <DriveWorkspaceLocationAdapter
        folderId={currentParentId}
        listRef={driveListRef}
        loadFolder={loadWorkspaceLocationFolder}
        workspaceId={workspaceId}
      />
      <section className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold leading-tight">
              파일
            </h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {currentFolderName} · {itemCountLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              onChange={(event) => void handleFileChange(event)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseDrive || isLoading}
              onClick={() => void reloadDrive()}
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              새로고침
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseDrive || isUploading}
              onClick={openFilePicker}
            >
              {isUploading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Upload />
              )}
              업로드
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseDrive || activeActionItemId === "create-document"}
              onClick={() => void handleCreateDocument()}
            >
              {activeActionItemId === "create-document" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FilePlus />
              )}
              새 문서
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canUseDrive}
              onClick={openCreateFolderSheet}
            >
              <FolderPlus />
              새 폴더
            </Button>
          </div>
        </div>

        <DriveUploadNotice
          uploadState={uploadState}
          onDismiss={() => setUploadState({ status: "idle" })}
        />

        {actionError ? (
          <p
            className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}

        <div className="rounded-lg border bg-background">
          <div className="flex min-h-12 items-center px-3">
            <DriveBreadcrumbs
              breadcrumbs={driveData.breadcrumbs}
              currentParentId={currentParentId}
              onNavigate={setCurrentParentId}
            />
          </div>
          <Separator />

          <div ref={driveListRef} className="min-h-0 overflow-x-auto">
            {status === "error" ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
                  <AlertCircle className="size-5" />
                </span>
                <div className="max-w-sm">
                  <h2 className="font-heading text-base font-semibold">
                    파일 목록을 불러오지 못했습니다
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {error?.message ?? "잠시 후 다시 시도해주세요."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canUseDrive || isLoading}
                  onClick={() => void reloadDrive()}
                >
                  <RefreshCw />
                  다시 시도
                </Button>
              </div>
            ) : isLoading ? (
              <DriveListSkeleton />
            ) : isEmpty ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground">
                  <Folder className="size-5" />
                </span>
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    비어 있습니다
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    이 위치에는 아직 파일이나 폴더가 없습니다.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canUseDrive || isUploading}
                    onClick={openFilePicker}
                  >
                    <Upload />
                    업로드
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canUseDrive}
                    onClick={openCreateFolderSheet}
                  >
                    <FolderPlus />
                    새 폴더
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canUseDrive || activeActionItemId === "create-document"}
                    onClick={() => void handleCreateDocument()}
                  >
                    <FilePlus />
                    새 문서
                  </Button>
                </div>
              </div>
            ) : (
              <div className="min-h-0">
                <div className="min-w-[780px]">
                  <div className="grid border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)_3rem]">
                    <span>이름</span>
                    <span>유형</span>
                    <span>크기</span>
                    <span>수정일</span>
                    <span className="text-right">작업</span>
                  </div>
                  <ul>
                    {driveData.items.map((item) => (
                      <DriveItemRow
                        key={item.id}
                        activeActionItemId={activeActionItemId}
                        item={item}
                        onDownload={(targetItem) =>
                          void handleDownloadItem(targetItem)
                        }
                        onOpenDelete={openDeleteDialog}
                        onOpenDocument={(document) => updateDocumentLocation(document.id)}
                        onOpenFolder={(folder) => setCurrentParentId(folder.id)}
                        onOpenMove={openMoveSheet}
                        onOpenPdf={setPreviewFile}
                        onOpenRename={openRenameSheet}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <CreateFolderSheet
        currentFolderName={currentFolderName}
        error={folderError}
        isOpen={isCreateOpen}
        isSubmitting={isCreatingFolder}
        name={folderName}
        onNameChange={setFolderName}
        onOpenChange={handleCreateOpenChange}
        onSubmit={handleCreateFolder}
      />

      <RenameItemSheet
        error={renameError}
        isSubmitting={isRenaming}
        item={renameItem}
        name={renameName}
        onNameChange={setRenameName}
        onOpenChange={handleRenameOpenChange}
        onSubmit={handleRenameSubmit}
      />

      <MoveItemSheet
        destination={moveDestinationData}
        destinationParentId={moveDestinationParentId}
        error={moveError}
        hasDestinationError={moveDestinationStatus === "error"}
        isDestinationReady={moveDestinationStatus === "success"}
        isLoading={moveDestinationStatus === "loading"}
        isSubmitting={isMoving}
        item={moveItem}
        onNavigate={navigateMoveDestination}
        onOpenChange={handleMoveOpenChange}
        onRetry={() =>
          setMoveDestinationRequestVersion((version) => version + 1)
        }
        onSelect={(parentId) => void handleMoveSelect(parentId)}
      />

      <DeleteItemDialog
        error={deleteError}
        isDeleting={isDeleting}
        item={deleteItem}
        onConfirm={() => void handleConfirmDelete()}
        onOpenChange={handleDeleteOpenChange}
      />

      <PdfPreviewDialog
        fileId={previewFile?.id ?? ""}
        fileName={previewFile?.name ?? ""}
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null);
          }
        }}
      />
    </div>
  );
}
