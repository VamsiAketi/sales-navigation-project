import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  allowSetImageDimensions$,
  closeImageDialog$,
  imageDialogState$,
  imageUploadHandler$,
  saveImage$,
  useCellValues,
  usePublisher,
  type SaveImageParameters,
} from "@mdxeditor/editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function emptyForm() {
  return {
    src: "",
    title: "",
    altText: "",
    width: "",
    height: "",
  };
}

function fileListFromFile(file: File): FileList {
  const dt = new DataTransfer();
  dt.items.add(file);
  return dt.files;
}

function parseDimension(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function MdxImageDialog() {
  const [state, imageUploadHandler, allowSetImageDimensions] = useCellValues(
    imageDialogState$,
    imageUploadHandler$,
    allowSetImageDimensions$,
  );
  const saveImage = usePublisher(saveImage$);
  const closeImageDialog = usePublisher(closeImageDialog$);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [form, setForm] = useState(emptyForm);

  const open = state.type !== "inactive";
  const isEditing = state.type === "editing";

  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setForm(emptyForm());
      return;
    }
    if (state.type === "editing") {
      const initial = state.initialValues;
      setForm({
        src: initial.src ?? "",
        title: initial.title ?? "",
        altText: initial.altText ?? "",
        width: initial.width != null ? String(initial.width) : "",
        height: initial.height != null ? String(initial.height) : "",
      });
      setSelectedFile(null);
      return;
    }
    setForm(emptyForm());
    setSelectedFile(null);
  }, [open, state]);

  const handleClose = useCallback(() => {
    closeImageDialog();
    setSelectedFile(null);
    setForm(emptyForm());
  }, [closeImageDialog]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const payload: SaveImageParameters = {
        altText: form.altText.trim(),
        title: form.title.trim(),
      };

      if (allowSetImageDimensions) {
        payload.width = parseDimension(form.width);
        payload.height = parseDimension(form.height);
      }

      if (selectedFile) {
        payload.file = fileListFromFile(selectedFile);
      } else {
        const src = form.src.trim();
        if (src) payload.src = src;
      }

      saveImage(payload);
      setSelectedFile(null);
      setForm(emptyForm());
    },
    [allowSetImageDimensions, form, saveImage, selectedFile],
  );

  if (!open) return null;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DialogContent className="z-[220] sm:max-w-md" overlayClassName="z-[220]" showCloseButton>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Image settings" : "Upload image"}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {imageUploadHandler ? (
            <div className="space-y-2">
              <Label htmlFor="mdx-image-file">Upload from device</Label>
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {selectedFile?.name ?? "No file chosen"}
                </span>
              </div>
              <input
                ref={fileInputRef}
                id="mdx-image-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="mdx-image-src">
              {imageUploadHandler ? "Or paste an image URL" : "Image URL"}
            </Label>
            <Input
              id="mdx-image-src"
              type="url"
              value={form.src}
              placeholder="https://…"
              onChange={(event) => setForm((prev) => ({ ...prev, src: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mdx-image-alt">Alt text</Label>
            <Input
              id="mdx-image-alt"
              value={form.altText}
              onChange={(event) => setForm((prev) => ({ ...prev, altText: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mdx-image-title">Title</Label>
            <Input
              id="mdx-image-title"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          {allowSetImageDimensions ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="mdx-image-width">Width</Label>
                <Input
                  id="mdx-image-width"
                  type="number"
                  min={0}
                  value={form.width}
                  onChange={(event) => setForm((prev) => ({ ...prev, width: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mdx-image-height">Height</Label>
                <Input
                  id="mdx-image-height"
                  type="number"
                  min={0}
                  value={form.height}
                  onChange={(event) => setForm((prev) => ({ ...prev, height: event.target.value }))}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
