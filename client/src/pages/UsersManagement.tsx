import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useCallback } from "react";
import { UserPlus, Trash2, Key, ToggleLeft, ToggleRight, Shield, User, Loader2, ArrowLeft } from "lucide-react";

// Instead of Dialog modals (which cause removeChild errors with Radix portals),
// we use inline panels that render in the same DOM tree.

type ViewMode = "list" | "create" | "resetPassword";

export default function UsersManagement() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();

  const { data: localUsers, isLoading } = trpc.localUsers.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Form state for create
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");

  // Form state for reset password
  const [newPassword, setNewPassword] = useState("");

  const resetForm = useCallback(() => {
    setNome("");
    setEmail("");
    setSenha("");
    setRole("user");
  }, []);

  const createUser = trpc.localUsers.create.useMutation({
    onSuccess: () => {
      toast.success("Usuário criado com sucesso!");
      resetForm();
      setViewMode("list");
      utils.localUsers.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteUser = trpc.localUsers.delete.useMutation({
    onSuccess: () => {
      toast.success("Usuário excluído!");
      setDeletingId(null);
      utils.localUsers.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      setDeletingId(null);
    },
  });

  const toggleActive = trpc.localUsers.toggleActive.useMutation({
    onSuccess: () => {
      utils.localUsers.list.invalidate();
      toast.success("Status atualizado!");
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPassword = trpc.localUsers.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida com sucesso!");
      setNewPassword("");
      setSelectedUserId(null);
      setViewMode("list");
      utils.localUsers.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!nome || !email || !senha) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    if (senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres");
      return;
    }
    createUser.mutate({ nome, email, senha, role });
  };

  const handleResetPassword = () => {
    if (!selectedUserId || !newPassword) return;
    if (newPassword.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres");
      return;
    }
    resetPassword.mutate({ id: selectedUserId, newPassword });
  };

  const handleDelete = (id: number) => {
    setDeletingId(id);
    deleteUser.mutate({ id });
  };

  if (!user || user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Acesso restrito a administradores.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {viewMode === "list" && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Gerenciar Usuários</h1>
                <p className="text-muted-foreground mt-1">
                  Cadastre e gerencie os usuários que terão acesso ao painel administrativo.
                </p>
              </div>
              <Button className="gap-2" onClick={() => setViewMode("create")}>
                <UserPlus className="h-4 w-4" />
                Novo Usuário
              </Button>
            </div>

            {/* Users List */}
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !localUsers || localUsers.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <UserPlus className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-semibold">Nenhum usuário cadastrado</h3>
                  <p className="text-muted-foreground mt-1 max-w-sm">
                    Clique em "Novo Usuário" para cadastrar o primeiro usuário do sistema.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {localUsers.map((u) => (
                  <Card key={u.id} className={`transition-all ${u.active ? "" : "opacity-60"}`}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${u.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                          {u.role === "admin" ? <Shield className="h-5 w-5" /> : <User className="h-5 w-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{u.nome}</span>
                            <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">
                              {u.role === "admin" ? "Admin" : "Usuário"}
                            </Badge>
                            {!u.active && (
                              <Badge variant="destructive" className="text-xs">Inativo</Badge>
                            )}
                            {u.mustChangePassword === 1 && (
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                Senha pendente
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{u.email}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Criado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                            {u.lastSignedIn && ` · Último acesso: ${new Date(u.lastSignedIn).toLocaleDateString("pt-BR")}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Toggle Active */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                          title={u.active ? "Desativar" : "Ativar"}
                        >
                          {u.active ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>

                        {/* Reset Password */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setNewPassword("");
                            setViewMode("resetPassword");
                          }}
                          title="Redefinir senha"
                        >
                          <Key className="h-4 w-4" />
                        </Button>

                        {/* Delete */}
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Excluir usuário"
                          disabled={deletingId === u.id}
                          onClick={() => {
                            if (window.confirm(`Tem certeza que deseja excluir o usuário ${u.nome} (${u.email})? Esta ação não pode ser desfeita.`)) {
                              handleDelete(u.id);
                            }
                          }}
                        >
                          {deletingId === u.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Create User Panel (inline, no modal) */}
        {viewMode === "create" && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => { setViewMode("list"); resetForm(); }}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Cadastrar Novo Usuário</h1>
                <p className="text-muted-foreground mt-1">
                  Preencha os dados abaixo para criar um novo acesso ao sistema.
                </p>
              </div>
            </div>

            <Card>
              <CardContent className="py-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="create-nome">Nome Completo *</Label>
                  <Input
                    id="create-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Nome do usuário"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-email">Email *</Label>
                  <Input
                    id="create-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-senha">Senha Inicial *</Label>
                  <Input
                    id="create-senha"
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <p className="text-xs text-muted-foreground">
                    O usuário deverá alterar a senha no primeiro acesso.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Perfil</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as "user" | "admin")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuário</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => { setViewMode("list"); resetForm(); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleCreate} disabled={createUser.isPending}>
                    {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Cadastrar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Reset Password Panel (inline, no modal) */}
        {viewMode === "resetPassword" && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => { setViewMode("list"); setNewPassword(""); setSelectedUserId(null); }}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Redefinir Senha</h1>
                <p className="text-muted-foreground mt-1">
                  Defina uma nova senha para o usuário selecionado.
                </p>
              </div>
            </div>

            <Card>
              <CardContent className="py-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-newPassword">Nova Senha</Label>
                  <Input
                    id="reset-newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => { setViewMode("list"); setNewPassword(""); setSelectedUserId(null); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleResetPassword} disabled={resetPassword.isPending}>
                    {resetPassword.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Redefinir Senha
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
