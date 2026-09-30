"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { AddMealDialog, type DayOption, type MealPick } from "./add-meal-dialog";

type Ctx = { open: (date?: string) => void };
const AddMealContext = createContext<Ctx | null>(null);

/** One "Add a meal" dialog for the whole week view; any button inside can open it for a day. */
export function AddMealProvider({
  days,
  defaultDate,
  recipes,
  children,
}: {
  days: DayOption[];
  defaultDate: string;
  recipes: MealPick[];
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{ open: boolean; date: string }>({
    open: false,
    date: defaultDate,
  });
  const open = useCallback(
    (date?: string) => setState({ open: true, date: date ?? defaultDate }),
    [defaultDate],
  );
  const value = useMemo(() => ({ open }), [open]);
  return (
    <AddMealContext.Provider value={value}>
      {children}
      <AddMealDialog
        open={state.open}
        onOpenChange={(next) => setState((s) => ({ ...s, open: next }))}
        days={days}
        defaultDate={state.date}
        recipes={recipes}
      />
    </AddMealContext.Provider>
  );
}

export function useAddMeal(): Ctx {
  const ctx = useContext(AddMealContext);
  if (!ctx) throw new Error("useAddMeal must be used inside <AddMealProvider>");
  return ctx;
}
