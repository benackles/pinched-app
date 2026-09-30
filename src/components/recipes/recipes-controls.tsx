"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Input, NativeSelect } from "@/components/ui/form-controls";
import type { Route } from "next";

/** Writes filters into the URL (so each view is linkable and cached by the service worker). */
function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const replace = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false });
  };
  return { params, replace };
}

export function RecipeSearch({ placeholder }: { placeholder: string }) {
  const { params, replace } = useUrlParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    // Only touch the URL when the search actually differs from it. (Comparing, rather than
    // skipping the first run, matters: React Strict Mode runs effects twice in development, and a
    // same-URL replace 300ms after load would cancel a link the person just clicked.)
    const next = value.trim() || null;
    if (next === (params.get("q") || null)) return;
    const id = setTimeout(() => replace({ q: next }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replace is stable enough; re-running on it would loop
  }, [value]);

  return (
    <div className="relative mb-6" role="search">
      <Search
        className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-12 rounded-full pl-11"
        aria-label="Search recipes"
        enterKeyHint="search"
      />
    </div>
  );
}

export function MineFilters({ collections }: { collections: { id: string; name: string }[] }) {
  const { params, replace } = useUrlParams();
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      <div className="w-52">
        <NativeSelect
          aria-label="Collection"
          className="rounded-full"
          value={params.get("collection") ?? ""}
          onChange={(e) => replace({ collection: e.target.value || null })}
        >
          <option value="">All collections</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="w-44">
        <NativeSelect
          aria-label="Cooked or not"
          className="rounded-full"
          value={params.get("cooked") ?? ""}
          onChange={(e) => replace({ cooked: e.target.value || null })}
        >
          <option value="">Cooked or not</option>
          <option value="yes">Cooked</option>
          <option value="no">Not cooked yet</option>
        </NativeSelect>
      </div>
    </div>
  );
}
