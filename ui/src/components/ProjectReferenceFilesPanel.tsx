import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { OverviewPageHeader, type OverviewContextFile } from "@/components/project-overview-shared";
import { cn } from "@/lib/utils";
import { FileText, RefreshCw, Trash2, Upload } from "lucide-react";

export function ProjectReferenceFilesPanel({
  embedded = false,
  files,
  selectedFiles,
  assetTitle,
  onAssetTitleChange,
  onChooseFiles,
  onUploadFiles,
  uploadPending,
  onReplaceFile,
  onRemoveFile,
  replacePending,
  removePending,
}: {
  embedded?: boolean;
  files: OverviewContextFile[];
  selectedFiles: File[];
  assetTitle: string;
  onAssetTitleChange: (value: string) => void;
  onChooseFiles: () => void;
  onUploadFiles: () => void;
  uploadPending: boolean;
  onReplaceFile: (fileId: string) => void;
  onRemoveFile: (fileId: string, title: string) => void;
  replacePending: boolean;
  removePending: boolean;
}) {
  return (
    <div className={embedded ? "space-y-5" : "mx-auto w-full max-w-4xl space-y-6"}>
      {!embedded ? (
        <OverviewPageHeader
          title="Files"
          description="Source documents for this project. The agent uses these during knowledge sync—they are not task requests."
          action={
            <Button type="button" size="sm" onClick={onChooseFiles}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Upload files
            </Button>
          }
        />
      ) : null}

      <div className={embedded ? "" : "rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5"}>
        {!embedded ? <p className="text-xs font-medium text-muted-foreground">New upload</p> : null}
        <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end", embedded ? "" : "mt-3")}>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onChooseFiles}>
              Choose files
            </Button>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {selectedFiles.length > 0
                ? selectedFiles.map((file) => file.name).join(", ")
                : "No files selected"}
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="file-display-title" className="text-xs text-muted-foreground">
              Display title (optional, single file)
            </Label>
            <Input
              id="file-display-title"
              value={assetTitle}
              onChange={(event) => onAssetTitleChange(event.target.value)}
              placeholder="e.g. Q2 sales playbook"
              disabled={selectedFiles.length > 1}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={onUploadFiles}
            disabled={uploadPending || selectedFiles.length === 0}
          >
            Upload
          </Button>
        </div>
      </div>

      {files.length === 0 ? (
        embedded ? (
          <EmptyState
            compact
            icon={FileText}
            message="No files attached"
            description="Upload SOPs, specs, contracts, or briefs."
            action="Upload files"
            onAction={onChooseFiles}
          />
        ) : (
          <EmptyState
            icon={FileText}
            message="No files attached to this project"
            description="Upload SOPs, specs, contracts, or briefs. They stay here until you remove them."
            action="Upload files"
            onAction={onChooseFiles}
          />
        )
      ) : (
        <div className={cn("overflow-hidden", embedded ? "rounded-lg border border-border/60" : "rounded-xl border border-border/80 bg-card shadow-xs")}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Filename</th>
                <th className="px-4 py-2.5 font-medium">Extraction</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-border/50 last:border-0 hover:bg-muted/15">
                  <td className="px-4 py-3 font-medium">{file.title}</td>
                  <td className="hidden max-w-xs truncate px-4 py-3 text-muted-foreground md:table-cell">
                    {file.originalFilename}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={file.extractionStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`Replace ${file.title}`}
                        disabled={replacePending}
                        onClick={() => onReplaceFile(file.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${file.title}`}
                        disabled={removePending}
                        onClick={() => onRemoveFile(file.id, file.title)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
