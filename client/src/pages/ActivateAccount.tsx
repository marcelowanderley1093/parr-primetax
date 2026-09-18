import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { Loader2, Lock, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";

const LOGO_FULL = "/img/logo-primetax-full.jpg";

// Pagina PUBLICA: /ativar-conta?token=...
// Estados: sem token | validando | token invalido/expirado | ativado com sucesso | formulario
export default function ActivateAccount() {
  const [, setLocation] = useLocation();
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activated, setActivated] = useState(false);

  const validation = trpc.activation.validate.useQuery(
    { token },
    { enabled: token.length > 0, retry: false, refetchOnWindowFocus: false }
  );

  const activate = trpc.activation.activate.useMutation({
    onSuccess: () => {
      setActivated(true);
      toast.success("Conta ativada com sucesso!");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    activate.mutate({ token, password });
  };

  const renderBody = () => {
    // 1. Sem token
    if (!token) {
      return (
        <Card className="shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-2" />
            <CardTitle className="text-xl font-semibold">Link inválido</CardTitle>
            <CardDescription>
              Este link de ativação não contém um token. Abra o link exatamente como veio no email do convite.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    // 2. Validando
    if (validation.isLoading) {
      return (
        <Card className="shadow-lg border-0">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Validando seu convite...</p>
          </CardContent>
        </Card>
      );
    }

    // 3. Token invalido/expirado (ou erro de rede)
    if (validation.isError || !validation.data?.valid) {
      return (
        <Card className="shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-2" />
            <CardTitle className="text-xl font-semibold">Convite inválido ou expirado</CardTitle>
            <CardDescription>
              Este link de ativação não é válido ou já expirou (validade de 7 dias). Solicite um novo email de ativação ao administrador.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="outline" onClick={() => setLocation("/login")}>Ir para o login</Button>
          </CardContent>
        </Card>
      );
    }

    // 4. Ativado com sucesso
    if (activated) {
      return (
        <Card className="shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-2" />
            <CardTitle className="text-xl font-semibold">Conta ativada!</CardTitle>
            <CardDescription>
              Sua senha foi definida. Agora você já pode entrar no painel com seu email e a nova senha.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setLocation("/login")}>Entrar no painel</Button>
          </CardContent>
        </Card>
      );
    }

    // 5. Formulario
    const { nome, email } = validation.data;
    return (
      <Card className="shadow-lg border-0">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-xl font-semibold">Olá, {nome}!</CardTitle>
          <CardDescription>
            Defina sua senha para ativar o acesso de <span className="font-medium">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="pl-10 pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  className="pl-10"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={activate.isPending}>
              {activate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ativar minha conta
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <img src={LOGO_FULL} alt="PrimeTax Solutions" className="h-12" />
        </div>
        {renderBody()}
        <p className="text-center text-xs text-muted-foreground">
          PrimeTax Solutions &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
