import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  created_at: string;
  last_sign_in_at: string | null;
  last_activity_at: string | null;
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [showPassword, setShowPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    userId: string;
    email: string;
    newRole: "admin" | "user";
  } | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []) as AppUser[];
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_create_user", {
        _email: email.trim().toLowerCase(),
        _password: password,
        _full_name: fullName.trim(),
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Потребителят е създаден");
      setAddOpen(false);
      setEmail("");
      setPassword("");
      setFullName("");
      setRole("user");
      setShowPassword(false);
      queryClient.invalidateQueries({ queryKey: ["admin_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "user" }) => {
      const { error } = await supabase.rpc("admin_set_user_role", {
        _user_id: userId,
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ролята е обновена");
      queryClient.invalidateQueries({ queryKey: ["admin_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_delete_user", {
        _user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Потребителят е изтрит");
      queryClient.invalidateQueries({ queryKey: ["admin_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Потребители</h1>
          <p className="text-sm text-muted-foreground mt-1">{users.length} общо</p>
        </div>
        <div className="flex justify-center">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Нов потребител
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Създай потребител</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Име (по избор)</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Име и фамилия" />
              </div>
              <div className="space-y-2">
                <Label>Имейл</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Парола</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Минимум 8 символа"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Скрий паролата" : "Покажи паролата"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Роля</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "user" | "admin")}
                  aria-label="Роля на потребителя"
                >
                  <option value="user">Потребител</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
              <Button
                className="w-full"
                onClick={() => createUserMutation.mutate()}
                disabled={!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || createUserMutation.isPending}
              >
                {createUserMutation.isPending ? "Създаване..." : "Създай"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Имейл</TableHead>
                <TableHead>Име</TableHead>
                <TableHead>Роля</TableHead>
                <TableHead>Последна активност</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    Няма потребители
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => {
                const isCurrentUser = u.user_id === currentUser?.id;
                return (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.full_name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={u.role === "admin" ? "bg-primary/10 text-primary border-primary/30" : ""}>
                        {u.role === "admin" ? "Администратор" : "Потребител"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.last_activity_at
                        ? new Date(u.last_activity_at).toLocaleString("bg-BG")
                        : u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleString("bg-BG")
                          : "Никога"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={u.role}
                          disabled={setRoleMutation.isPending || (isCurrentUser && u.role === "admin")}
                          aria-label={`Роля на ${u.email}`}
                          onChange={(e) => {
                            const newRole = e.target.value as "admin" | "user";
                            if (newRole !== u.role) {
                              e.target.value = u.role;
                              setRoleChangeTarget({
                                userId: u.user_id,
                                email: u.email,
                                newRole,
                              });
                            }
                          }}
                        >
                          <option value="user">Потребител</option>
                          <option value="admin">Администратор</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isCurrentUser || deleteUserMutation.isPending}
                          onClick={() => setDeleteTarget(u)}
                          title={isCurrentUser ? "Не може да изтриете текущия акаунт" : "Изтрий"}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        variant="destructive"
        title="Изтриване на потребител"
        description={`Сигурни ли сте, че искате да изтриете ${deleteTarget?.email}? Това действие е необратимо.`}
        confirmLabel="Изтрий"
        loading={deleteUserMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteUserMutation.mutate(deleteTarget.user_id, {
              onSettled: () => setDeleteTarget(null),
            });
          }
        }}
      />

      <ConfirmDialog
        open={!!roleChangeTarget}
        onOpenChange={(open) => !open && setRoleChangeTarget(null)}
        variant="warning"
        title="Промяна на роля"
        description={`Сигурни ли сте, че искате да промените ролята на ${roleChangeTarget?.email} на "${roleChangeTarget?.newRole === "admin" ? "Администратор" : "Потребител"}"?`}
        confirmLabel="Промени"
        loading={setRoleMutation.isPending}
        onConfirm={() => {
          if (roleChangeTarget) {
            setRoleMutation.mutate(
              { userId: roleChangeTarget.userId, role: roleChangeTarget.newRole },
              { onSettled: () => setRoleChangeTarget(null) },
            );
          }
        }}
      />
    </div>
  );
}
