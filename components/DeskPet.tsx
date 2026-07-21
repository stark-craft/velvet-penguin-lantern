"use client";

import { useState } from "react";
import type { ViewerProfile } from "@/types/news";

const faces = { orbit: "•ᴗ•", pixel: "•ﻌ•", cloud: "˶ᵔ ᵕ ᵔ˶" } as const;

export function DeskPet({ viewer, notificationCount, onOpenNotifications }: { viewer: ViewerProfile; notificationCount: number; onOpenNotifications: () => void }) {
  const [position, setPosition] = useState(0);
  if (!viewer.petEnabled) return null;
  const move = () => setPosition((value) => (value + 1) % 4);
  return <aside className={`desk-pet pet-${viewer.petKind} pet-${viewer.petColor} pet-position-${position}`} aria-label={`${viewer.displayName}’s desk companion`}>
    {notificationCount > 0 && <button className="pet-message" onClick={onOpenNotifications}>{notificationCount} new signal{notificationCount === 1 ? "" : "s"}<span>Open notifications</span></button>}
    <button className="pet-body" onClick={move} title="Move your desk companion" aria-label="Move your desk companion">
      <span className="pet-antenna" /><span className="pet-face">{faces[viewer.petKind]}</span><i /><b />
    </button>
  </aside>;
}
