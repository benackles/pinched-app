"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";

import { useAddMeal } from "./add-meal-provider";

export function AddMealButton({
  date,
  label = "Add",
  variant = "ghost",
  size = "sm",
}: {
  date?: string;
  label?: string;
  variant?: "ghost" | "default" | "outline" | "secondary";
  size?: "sm" | "default";
}) {
  const { open } = useAddMeal();
  const online = useOnline();
  return (
    <Button variant={variant} size={size} disabled={!online} onClick={() => open(date)}>
      <Plus aria-hidden /> {label}
      {date && <span className="sr-only"> meal to this day</span>}
    </Button>
  );
}
