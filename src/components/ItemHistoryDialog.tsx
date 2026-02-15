import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wrench, AlertTriangle, Package, ChevronsDown } from "lucide-react";
import { FaArrowRight, FaArrowLeft } from "react-icons/fa";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import excelIcon from "@/assets/excell.svg";

const PAGE_SIZE = 20;

interface Props {
  itemId: string;
  itemCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TimelineEntry = {
  id: string;
  date: string;
  type: "issue" | "return" | "repair";
  employeeName?: string;
  condition?: string | null;
  consumableNote?: string | null;
  issuedByName?: string | null;
  repairCost?: number;
  repairNotes?: string | null;
};

export function ItemHistoryDialog({ itemId, itemCode, open, onOpenChange }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when dialog opens with a new item
  useEffect(() => {
    if (open) setVisibleCount(PAGE_SIZE);
  }, [open, itemId]);

  const { data: timeline = [], isPending } = useQuery({
    queryKey: ["item_history", itemId],
    queryFn: async () => {
      // Fetch movements for this item
      const { data: movements, error: movErr } = await supabase
        .from("movements")
        .select("id, created_at, movement_type, condition, consumable_note, issued_by, employees(name)")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false });
      if (movErr) throw movErr;

      // Fetch repair history for this item
      const { data: repairs, error: repErr } = await supabase
        .from("repair_history")
        .select("id, created_at, cost, notes")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false });
      if (repErr) throw repErr;

      // Fetch profile names for issued_by user IDs
      const userIds = [...new Set((movements ?? []).map((m) => m.issued_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profiles) {
          profileMap = profiles.reduce<Record<string, string>>((acc, p) => {
            acc[p.id] = p.full_name;
            return acc;
          }, {});
        }
      }

      const entries: TimelineEntry[] = [];

      for (const m of movements ?? []) {
        entries.push({
          id: m.id,
          date: m.created_at,
          type: m.movement_type as "issue" | "return",
          employeeName: (m.employees as { name: string } | null)?.name,
          condition: m.condition,
          consumableNote: m.consumable_note,
          issuedByName: m.issued_by ? profileMap[m.issued_by] ?? null : null,
        });
      }

      for (const r of repairs ?? []) {
        entries.push({
          id: r.id,
          date: r.created_at,
          type: "repair",
          repairCost: r.cost,
          repairNotes: r.notes,
        });
      }

      // Sort by date descending (newest first)
      entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return entries;
    },
    enabled: open && !!itemId,
  });

  const visibleEntries = timeline.slice(0, visibleCount);
  const hasMore = visibleCount < timeline.length;

  const exportToExcel = () => {
    const rows = timeline.map((entry) => ({
      "Дата": format(new Date(entry.date), "dd.MM.yyyy HH:mm"),
      "Тип": entry.type === "issue" ? "Отдаден" : entry.type === "return" ? "Върнат" : "Ремонт",
      "Служител": entry.employeeName ?? "",
      "Състояние": entry.condition && entry.condition !== "Без забележки" ? entry.condition : "",
      "Цена ремонт (€)": entry.type === "repair" ? Number(entry.repairCost ?? 0).toFixed(2) : "",
      "Забележка": entry.consumableNote || entry.repairNotes || "",
      "Предал": entry.issuedByName ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "История");
    XLSX.writeFile(wb, `история_${itemCode}.xlsx`);
  };

  const typeConfig = {
    issue: {
      icon: FaArrowRight,
      label: "Отдаден",
      color: "text-primary",
      bg: "bg-primary/10",
    },
    return: {
      icon: FaArrowLeft,
      label: "Върнат",
      color: "text-success",
      bg: "bg-success/10",
    },
    repair: {
      icon: Wrench,
      label: "Ремонт",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-20">
            <Package className="w-5 h-5 text-primary shrink-0" />
            <span>История на <span className="font-mono">{itemCode}</span></span>
            {!isPending && timeline.length > 0 && (
              <Badge variant="outline" className="ml-auto text-xs font-normal shrink-0">
                {timeline.length} записа
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {!isPending && timeline.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                tabIndex={-1}
                onClick={exportToExcel}
                className="absolute right-14 top-4 flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 ring-offset-background transition-all hover:opacity-100 hover:border-primary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <img src={excelIcon} alt="Експорт в Excel" className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Експорт в Excel</TooltipContent>
          </Tooltip>
        )}

        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {isPending && (
            <div className="space-y-4 p-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isPending && timeline.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Няма записана история за този артикул</p>
            </div>
          )}

          {!isPending && timeline.length > 0 && (
            <div className="relative pl-6 p-1">
              {/* Vertical timeline line */}
              <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />

              <div className="space-y-4">
                {visibleEntries.map((entry, idx) => {
                  const config = typeConfig[entry.type];
                  const Icon = config.icon;
                  return (
                    <div key={entry.id + idx} className="relative flex gap-3">
                      {/* Timeline dot */}
                      <div className={`z-10 flex items-center justify-center w-7 h-7 rounded-full ${config.bg} shrink-0 -ml-[14px]`}>
                        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                      </div>

                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`${config.bg} ${config.color} border-transparent text-xs`}>
                            {config.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(entry.date), "dd.MM.yyyy HH:mm")}
                          </span>
                        </div>

                        {entry.type === "issue" && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">на </span>
                            <span className="font-medium">{entry.employeeName ?? "—"}</span>
                            {entry.condition && entry.condition !== "Без забележки" && (
                              <span className="text-muted-foreground"> • {entry.condition}</span>
                            )}
                          </p>
                        )}

                        {entry.type === "return" && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">от </span>
                            <span className="font-medium">{entry.employeeName ?? "—"}</span>
                            {entry.condition && entry.condition !== "Без забележки" && (
                              <span className="text-muted-foreground"> • {entry.condition}</span>
                            )}
                          </p>
                        )}

                        {entry.type === "repair" && (
                          <p className="text-sm mt-1">
                            <span className="font-medium">{Number(entry.repairCost ?? 0).toFixed(2)} €</span>
                            {entry.repairNotes && (
                              <span className="text-muted-foreground"> — {entry.repairNotes}</span>
                            )}
                          </p>
                        )}

                        {entry.consumableNote && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Забележка: {entry.consumableNote}
                          </p>
                        )}

                        {entry.issuedByName && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Предал: {entry.issuedByName}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div className="relative z-10 flex justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  >
                    <ChevronsDown className="w-4 h-4" />
                    Зареди още ({timeline.length - visibleCount} остават)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
