import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FolderCog, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

interface CategoryManagerDialogProps {
  categories: Tables<"categories">[];
}

export function CategoryManagerDialog({ categories }: CategoryManagerDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Add form
  const [addMode, setAddMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCodeFrom, setNewCodeFrom] = useState("");
  const [newCodeTo, setNewCodeTo] = useState("");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCodeFrom, setEditCodeFrom] = useState("");
  const [editCodeTo, setEditCodeTo] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
  };

  const resetAddForm = () => {
    setAddMode(false);
    setNewName("");
    setNewCodeFrom("");
    setNewCodeTo("");
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = newName.trim();
      if (!trimmedName) throw new Error("Името е задължително");
      if (!newCodeFrom.trim() || !newCodeTo.trim()) throw new Error("Кодовете са задължителни");
      const { error } = await supabase.from("categories").insert({
        name: trimmedName,
        code_from: newCodeFrom.trim(),
        code_to: newCodeTo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Категорията е добавена");
      resetAddForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const trimmedName = editName.trim();
      if (!trimmedName) throw new Error("Името е задължително");
      if (!editCodeFrom.trim() || !editCodeTo.trim()) throw new Error("Кодовете са задължителни");
      const { error } = await supabase.from("categories").update({
        name: trimmedName,
        code_from: editCodeFrom.trim(),
        code_to: editCodeTo.trim(),
      }).eq("id", editId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Категорията е обновена");
      setEditId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { count, error: countErr } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("category_id", id);
      if (countErr) throw countErr;
      if (count && count > 0) {
        throw new Error(`Категорията има ${count} артикула и не може да бъде изтрита.`);
      }
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Категорията е изтрита");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const startEdit = (cat: Tables<"categories">) => {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditCodeFrom(cat.code_from);
    setEditCodeTo(cat.code_to);
    setAddMode(false);
  };

  const cancelEdit = () => {
    setEditId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { resetAddForm(); cancelEdit(); } }}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <FolderCog className="w-4 h-4" />
            Категории
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle>Управление на категории</DialogTitle>
          </DialogHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Име</TableHead>
                <TableHead>Код от</TableHead>
                <TableHead>Код до</TableHead>
                <TableHead className="w-24">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) =>
                editId === cat.id ? (
                  <TableRow key={cat.id}>
                    <TableCell>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                    </TableCell>
                    <TableCell>
                      <Input value={editCodeFrom} onChange={(e) => setEditCodeFrom(e.target.value)} className="h-8 w-20" />
                    </TableCell>
                    <TableCell>
                      <Input value={editCodeTo} onChange={(e) => setEditCodeTo(e.target.value)} className="h-8 w-20" />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-success" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit} disabled={updateMutation.isPending}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell>{cat.code_from}</TableCell>
                    <TableCell>{cat.code_to}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(cat)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget({ id: cat.id, name: cat.name })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              )}

              {/* Add row */}
              {addMode && (
                <TableRow>
                  <TableCell>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Име на категория" className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input value={newCodeFrom} onChange={(e) => setNewCodeFrom(e.target.value)} placeholder="001" className="h-8 w-20" />
                  </TableCell>
                  <TableCell>
                    <Input value={newCodeTo} onChange={(e) => setNewCodeTo(e.target.value)} placeholder="100" className="h-8 w-20" />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-success" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={resetAddForm} disabled={addMutation.isPending}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {!addMode && !editId && (
            <Button variant="outline" className="gap-2 mt-2" onClick={() => setAddMode(true)}>
              <Plus className="w-4 h-4" />
              Добави категория
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Изтриване на категория"
        description={`Сигурни ли сте, че искате да изтриете "${deleteTarget?.name}"?`}
        confirmLabel="Изтрий"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
