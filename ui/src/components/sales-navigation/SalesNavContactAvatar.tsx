import { useEffect, useState } from "react";
import type { SalesNavContactLevel } from "@paperclipai/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import {
  salesNavContactInitials,
  salesNavLinkedInAvatarSrc,
  salesNavResolveLinkedInUrl,
} from "@/lib/sales-navigation/linkedin-avatar";

const LEVEL_RING: Record<SalesNavContactLevel, string> = {
  warm_intro: "ring-emerald-500/60",
  internal_champion: "ring-sky-500/60",
  influencer: "ring-amber-500/60",
  technical_evaluator: "ring-muted-foreground/40",
  decision_maker: "ring-violet-500/60",
  procurement: "ring-orange-500/60",
};

export function SalesNavContactAvatar({
  name,
  linkedinUrl,
  level,
  size = "sm",
  className,
  showLevelRing = false,
}: {
  name: string;
  linkedinUrl?: string | null;
  level?: SalesNavContactLevel;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
  showLevelRing?: boolean;
}) {
  const { selectedCompanyId } = useCompany();
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedLinkedInUrl = salesNavResolveLinkedInUrl(name, linkedinUrl);

  useEffect(() => {
    setImageFailed(false);
  }, [linkedinUrl, name]);
  const avatarSrc =
    selectedCompanyId && resolvedLinkedInUrl && !imageFailed
      ? salesNavLinkedInAvatarSrc(selectedCompanyId, resolvedLinkedInUrl)
      : null;

  return (
    <Avatar
      size={size}
      className={cn(
        showLevelRing && level && `ring-2 ring-offset-1 ring-offset-background ${LEVEL_RING[level]}`,
        className,
      )}
    >
      {avatarSrc ? (
        <AvatarImage
          src={avatarSrc}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[10px] font-semibold text-foreground">
        {salesNavContactInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
