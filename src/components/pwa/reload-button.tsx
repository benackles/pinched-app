"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ReloadButton() {
  return (
    <Button variant="outline" onClick={() => window.location.reload()}>
      <RefreshCw /> Try again
    </Button>
  );
}
