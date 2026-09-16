import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertTriangle,
  Scale,
  FileWarning,
  Clock,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
  Users,
  Award,
  CheckCircle,
  ArrowRight,
  Star,
  MessageSquare,
  Gavel,
  Ban,
  Lock,
  Target,
  Briefcase,
} from "lucide-react";

const WHATSAPP_LINK = "https://wa.me/5511950725423?text=Ol%C3%A1%2C%20fui%20notificado%20no%20PARR%20e%20preciso%20de%20ajuda";

const LOGO_FULL = "https://d2xsxph8kpxj0f.cloudfront.net/310419663029061734/ce79CANEMgyhDB3mYkEo3G/logo-primetax-full_0492e20f.jpg";
const LOGO_SMALL = "https://d2xsxph8kpxj0f.cloudfront.net/310419663029061734/ce79CANEMgyhDB3mYkEo3G/logo-primetax-small_1a682f6d.jpg";

function Navbar() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-border shadow-sm">
      <div className="container flex items-center justify-between h-16">
        <a href="#" className="flex items-center">
          <img src={LOGO_FULL} alt="PrimeTax Solutions" className="h-10 hidden sm:block" />
          <img src={LOGO_SMALL} alt="PrimeTax" className="h-8 sm:hidden" />
        </a>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-foreground/80">
          <a href="#problema" className="hover:text-[oklch(0.35_0.03_240)] transition-colors">O Problema</a>
          <a href="#consequencias" className="hover:text-[oklch(0.35_0.03_240)] transition-colors">Consequências</a>
          <a href="#defesa" className="hover:text-[oklch(0.35_0.03_240)] transition-colors">Sua Defesa</a>
          <a href="#servicos" className="hover:text-[oklch(0.35_0.03_240)] transition-colors">Serviços</a>
          <a href="#faq" className="hover:text-[oklch(0.35_0.03_240)] transition-colors">FAQ</a>
          <a href="/dashboard" className="hover:text-[oklch(0.62_0.12_185)] text-[oklch(0.62_0.12_185)] font-semibold transition-colors flex items-center gap-1">
            Painel Admin
          </a>
          <a href="#contato">
            <Button className="bg-[oklch(0.62_0.12_185)] hover:bg-[oklch(0.55_0.12_185)] text-white font-semibold px-5">
              Falar com Especialista
            </Button>
          </a>
        </div>
        <button className="md:hidden" onClick={() => setOpen(!open)}>
          <div className="space-y-1.5">
            <div className="w-6 h-0.5 bg-foreground"></div>
            <div className="w-6 h-0.5 bg-foreground"></div>
            <div className="w-6 h-0.5 bg-foreground"></div>
          </div>
        </button>
      </div>
      {open && (
        <div className="md:hidden bg-white border-t border-border px-4 pb-4 space-y-3">
          <a href="#problema" className="block py-2 text-sm" onClick={() => setOpen(false)}>O Problema</a>
          <a href="#consequencias" className="block py-2 text-sm" onClick={() => setOpen(false)}>Consequências</a>
          <a href="#defesa" className="block py-2 text-sm" onClick={() => setOpen(false)}>Sua Defesa</a>
          <a href="#servicos" className="block py-2 text-sm" onClick={() => setOpen(false)}>Serviços</a>
          <a href="#faq" className="block py-2 text-sm" onClick={() => setOpen(false)}>FAQ</a>
          <a href="/dashboard" className="block py-2 text-sm font-semibold text-[oklch(0.62_0.12_185)]" onClick={() => setOpen(false)}>Painel Admin</a>
          <a href="#contato" onClick={() => setOpen(false)}>
            <Button className="w-full bg-[oklch(0.62_0.12_185)] hover:bg-[oklch(0.55_0.12_185)] text-white">Falar com Especialista</Button>
          </a>
        </div>
      )}
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden" style={{ background: "linear-gradient(135deg, oklch(0.30 0.02 240) 0%, oklch(0.35 0.03 240) 50%, oklch(0.25 0.02 240) 100%)" }}>
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-[oklch(0.62_0.12_185)] blur-[100px]"></div>
        <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-[oklch(0.50_0.10_185)] blur-[120px]"></div>
      </div>
      <div className="container relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-6">
            <AlertTriangle className="h-4 w-4 text-[oklch(0.62_0.12_185)]" />
            <span className="text-white/90 text-sm font-medium">Alerta: +357 mil procedimentos até fevereiro de 2025</span>
          </div>
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
            Você foi notificado no <span className="text-[oklch(0.62_0.12_185)]">PARR</span> pela PGFN?
          </h1>
          <p className="text-lg md:text-xl text-white/80 mb-4 leading-relaxed max-w-2xl mx-auto">
            Seu patrimônio pessoal pode estar em risco. A PGFN está responsabilizando sócios por dívidas da empresa — e o prazo para se defender é de apenas <strong className="text-white">15 dias</strong>.
          </p>
          <p className="text-base text-white/60 mb-8 max-w-xl mx-auto">
            Entenda como a Primetax pode proteger seus bens com defesa técnica especializada.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
              <Button size="lg" className="bg-[oklch(0.62_0.12_185)] hover:bg-[oklch(0.55_0.12_185)] text-white font-bold text-lg px-8 py-6 shadow-lg shadow-[oklch(0.62_0.12_185)]/30">
                <Phone className="mr-2 h-5 w-5" /> Falar com Especialista Agora
              </Button>
            </a>
            <a href="#contato">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 font-semibold text-lg px-8 py-6">
                Solicitar Análise Gratuita <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </a>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
          <path d="M0 60L1440 60L1440 0C1440 0 1080 40 720 40C360 40 0 0 0 0L0 60Z" fill="oklch(0.99 0 0)" />
        </svg>
      </div>
    </section>
  );
}

function StatsBar() {
  const stats = [
    { number: "357.486", label: "Procedimentos em Fev/2025", icon: TrendingUp },
    { number: "288%", label: "Crescimento em 8 meses", icon: AlertTriangle },
    { number: "15 dias", label: "Prazo para impugnação", icon: Clock },
    { number: "R$ Bilhões", label: "Em cobranças ativas", icon: Scale },
  ];
  return (
    <section className="py-8 bg-[oklch(0.97_0.003_250)]">
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <stat.icon className="h-6 w-6 mx-auto mb-2 text-[oklch(0.62_0.12_185)]" />
              <div className="text-2xl md:text-3xl font-extrabold text-[oklch(0.35_0.03_240)]">{stat.number}</div>
              <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemaSection() {
  return (
    <section id="problema" className="py-16 md:py-24">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Entenda o risco</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-4">
            O que é o PARR e por que você deve se preocupar?
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            O Procedimento Administrativo de Reconhecimento de Responsabilidade (PARR) é o instrumento que a PGFN utiliza para cobrar dívidas tributárias da empresa diretamente dos sócios e administradores.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="bg-white rounded-xl border border-border p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center mb-4">
              <FileWarning className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-3">Dissolução Irregular</h3>
            <p className="text-muted-foreground leading-relaxed">
              A PGFN alega que sua empresa foi encerrada irregularmente — sem baixa formal no CNPJ — e usa isso como justificativa para transferir a dívida para o CPF dos sócios. Mesmo empresas com CNPJ ativo estão sendo notificadas.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center mb-4">
              <TrendingUp className="h-6 w-6 text-amber-500" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-3">Crescimento Explosivo</h3>
            <p className="text-muted-foreground leading-relaxed">
              De junho/2024 a fevereiro/2025, os procedimentos PARR saltaram de 92 mil para mais de 357 mil — um crescimento de 288%. A PGFN está usando o PARR como ferramenta massiva de cobrança.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-blue-500" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-3">Prazo Curto e Perigoso</h3>
            <p className="text-muted-foreground leading-relaxed">
              Você tem apenas 15 dias para apresentar impugnação após ser notificado. Se perder o prazo, será incluído automaticamente na Certidão de Dívida Ativa (CDA) e poderá ser executado judicialmente.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center mb-4">
              <Gavel className="h-6 w-6 text-purple-500" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-3">Base Legal: Art. 135 do CTN</h3>
            <p className="text-muted-foreground leading-relaxed">
              O PARR se fundamenta no artigo 135 do CTN e na Lei 10.522/2002. A Portaria PGFN 1160/2024 ampliou o escopo para qualquer ilícito tributário, não apenas dissolução irregular.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConsequenciasSection() {
  const items = [
    { icon: Ban, title: "Inclusão na CDA", desc: "Seu CPF é inscrito na Certidão de Dívida Ativa da União, gerando restrições imediatas." },
    { icon: Lock, title: "Penhora de Bens", desc: "Imóveis, veículos, contas bancárias e investimentos podem ser bloqueados judicialmente." },
    { icon: AlertTriangle, title: "Restrição de Crédito", desc: "Nome negativado impossibilita financiamentos, empréstimos e operações bancárias." },
    { icon: FileWarning, title: "Execução Fiscal", desc: "A PGFN pode ajuizar execução fiscal diretamente contra seu patrimônio pessoal." },
    { icon: Target, title: "Bloqueio Judicial", desc: "Contas bancárias podem ser bloqueadas via BacenJud sem aviso prévio." },
    { icon: Scale, title: "Responsabilidade Solidária", desc: "A dívida da empresa passa a ser sua dívida pessoal, sem limite de valor." },
  ];
  return (
    <section id="consequencias" className="py-16 md:py-24 bg-[oklch(0.30_0.02_240)]">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Atenção</span>
          <h2 className="text-3xl md:text-4xl font-bold text-white mt-3 mb-4">
            O que acontece se você não agir?
          </h2>
          <p className="text-lg text-white/70 leading-relaxed">
            Ignorar a notificação do PARR pode resultar em consequências graves e irreversíveis para seu patrimônio pessoal e familiar.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {items.map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
              <item.icon className="h-8 w-8 text-[oklch(0.62_0.12_185)] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
              <p className="text-white/60 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FalhasLegaisSection() {
  const falhas = [
    {
      title: "Inversão do Ônus da Prova",
      desc: "A PGFN notifica sem apresentar provas da dissolução irregular. Na prática, é o sócio que precisa provar que NÃO cometeu ilícito — uma clara violação ao princípio da presunção de inocência.",
    },
    {
      title: "Violação ao Contraditório",
      desc: "As notificações são simples e desacompanhadas de documentação probatória. O contribuinte é obrigado a se defender sem sequer conhecer as provas contra ele.",
    },
    {
      title: "Limitações Técnicas do Regularize",
      desc: "A defesa é feita pelo sistema Regularize com limite de caracteres e apenas 5 arquivos de 5MB — insuficiente para casos complexos que envolvem milhões.",
    },
    {
      title: "Notificação Precária",
      desc: "A notificação é enviada prioritariamente pelo Regularize. O contribuinte precisa monitorar mais uma caixa de mensagens para não perder o prazo de 15 dias.",
    },
  ];
  return (
    <section id="defesa" className="py-16 md:py-24">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Argumentos de defesa</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-4">
            O PARR possui falhas legais exploráveis
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Nossos especialistas identificaram vulnerabilidades jurídicas significativas no procedimento que podem ser usadas na sua defesa.
          </p>
        </div>
        <div className="max-w-4xl mx-auto space-y-6">
          {falhas.map((f, i) => (
            <div key={i} className="flex gap-5 bg-white rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[oklch(0.35_0.03_240)] flex items-center justify-center text-white font-bold text-sm">
                {i + 1}
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <a href="#contato">
            <Button size="lg" className="bg-[oklch(0.62_0.12_185)] hover:bg-[oklch(0.55_0.12_185)] text-white font-bold px-8">
              Quero Minha Defesa Técnica <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

function ServicosSection() {
  const servicos = [
    { icon: FileWarning, title: "Análise da Notificação", desc: "Avaliação completa da notificação PARR recebida, identificando vícios formais e materiais que podem invalidar o procedimento." },
    { icon: Gavel, title: "Impugnação Administrativa", desc: "Elaboração de defesa técnica dentro do prazo de 15 dias, com fundamentação jurídica robusta e jurisprudência favorável." },
    { icon: Scale, title: "Recursos Administrativos", desc: "Interposição de recursos contra decisões desfavoráveis, esgotando todas as vias administrativas disponíveis." },
    { icon: Lock, title: "Blindagem Patrimonial", desc: "Estruturação legal para proteção do patrimônio pessoal e familiar contra penhoras e execuções fiscais." },
    { icon: Briefcase, title: "Contencioso Judicial", desc: "Ações judiciais para desconstituir a responsabilidade tributária, incluindo mandados de segurança e anulatórias." },
    { icon: Target, title: "Transação Tributária", desc: "Negociação direta com a PGFN para regularização da dívida com descontos de até 70% em multas e juros." },
  ];
  return (
    <section id="servicos" className="py-16 md:py-24 bg-[oklch(0.97_0.003_250)]">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Como podemos ajudar</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-4">
            Serviços Especializados em Defesa PARR
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Atuação completa desde a análise da notificação até a resolução definitiva do caso.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {servicos.map((s, i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-all hover:-translate-y-1">
              <div className="w-12 h-12 rounded-lg bg-[oklch(0.35_0.03_240)]/10 flex items-center justify-center mb-4">
                <s.icon className="h-6 w-6 text-[oklch(0.35_0.03_240)]" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{s.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstitucionalSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="container">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Sobre a Primetax</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-6">
              Inteligência Tributária de Vanguarda
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              A Primetax é uma consultoria especializada em inteligência tributária e defesa de empresários. Com atuação em recuperação de créditos (PIS, COFINS, ICMS, FGTS), planejamento fiscal, transação tributária e contencioso administrativo/judicial.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Nossa equipe é liderada por profissionais com experiência prática na Receita Federal, o que nos dá uma visão única de como o Fisco opera — e como construir a melhor defesa para nossos clientes.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">Ex-Auditores da RFB</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">+14 anos de experiência</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">Atuação nacional</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">Resultados comprovados</span>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-[oklch(0.35_0.03_240)] to-[oklch(0.30_0.02_240)] rounded-2xl p-8 text-white">
            <div className="w-24 h-24 rounded-full overflow-hidden mb-6 mx-auto border-2 border-white/20 shadow-lg">
              <img src="https://d2xsxph8kpxj0f.cloudfront.net/310419663029061734/ce79CANEMgyhDB3mYkEo3G/marcelo-wanderley-photo_549a8c91.webp" alt="Marcelo Wanderley" className="w-full h-full object-cover object-top" />
            </div>
            <h3 className="text-xl font-bold text-center mb-2">Marcelo Wanderley</h3>
            <p className="text-white/70 text-center text-sm mb-4">CEO & Fundador da Primetax</p>
            <p className="text-white/80 text-sm leading-relaxed text-center">
              Advogado tributarista e ex-Auditor Fiscal da Receita Federal por 14 anos. Especialista em recuperação de créditos tributários, planejamento fiscal e defesa de empresários contra abusos do Fisco.
            </p>
            <div className="mt-6 pt-6 border-t border-white/20 flex justify-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold">14+</div>
                <div className="text-xs text-white/60">Anos na RFB</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">500+</div>
                <div className="text-xs text-white/60">Clientes atendidos</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">R$M+</div>
                <div className="text-xs text-white/60">Recuperados</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DepoimentosSection() {
  const depoimentos = [
    { name: "Carlos M.", role: "Empresário - Construção Civil", text: "Fui notificado no PARR e estava desesperado. A Primetax analisou meu caso, encontrou falhas na notificação e conseguiu reverter a responsabilização. Salvaram meu patrimônio.", stars: 5 },
    { name: "Ana Paula S.", role: "Sócia - Clínica Médica", text: "A equipe da Primetax é extremamente competente. Apresentaram a impugnação dentro do prazo e com argumentação técnica impecável. Recomendo sem hesitar.", stars: 5 },
    { name: "Roberto F.", role: "Empresário - Agronegócio", text: "O que mais me impressionou foi o conhecimento prático de como a Receita Federal opera. Isso fez toda a diferença na estratégia de defesa do meu caso.", stars: 5 },
  ];
  return (
    <section className="py-16 md:py-24 bg-[oklch(0.97_0.003_250)]">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Depoimentos</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-4">
            O que nossos clientes dizem
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {depoimentos.map((d, i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-6 shadow-sm">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: d.stars }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-[oklch(0.62_0.12_185)] text-[oklch(0.62_0.12_185)]" />
                ))}
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4 italic">"{d.text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[oklch(0.35_0.03_240)]/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-[oklch(0.35_0.03_240)]">{d.name[0]}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs = [
    { q: "O que é o PARR?", a: "O PARR (Procedimento Administrativo de Reconhecimento de Responsabilidade) é um procedimento da PGFN que visa responsabilizar sócios e administradores pelas dívidas tributárias da empresa, especialmente em casos de dissolução irregular." },
    { q: "Qual o prazo para me defender?", a: "O prazo para apresentar impugnação é de 15 dias corridos a partir do recebimento da notificação. Se o prazo for perdido, o contribuinte será incluído automaticamente na CDA." },
    { q: "Posso perder meus bens pessoais?", a: "Sim. Se a responsabilidade for reconhecida, seu CPF será inscrito na dívida ativa e a PGFN poderá executar judicialmente seu patrimônio pessoal — imóveis, veículos, contas bancárias e investimentos." },
    { q: "O PARR tem falhas legais?", a: "Sim. Os principais vícios são: inversão do ônus da prova (a PGFN não apresenta provas), violação ao contraditório, limitações técnicas do sistema Regularize e notificação precária." },
    { q: "Quanto custa a defesa?", a: "Cada caso é único. Oferecemos uma análise inicial gratuita da sua notificação e, a partir do diagnóstico, apresentamos uma proposta personalizada com honorários transparentes." },
    { q: "Vocês atuam em todo o Brasil?", a: "Sim. Nossa atuação é nacional, com atendimento remoto e presencial quando necessário. Utilizamos tecnologia para garantir agilidade e eficiência em qualquer localidade." },
  ];
  return (
    <section id="faq" className="py-16 md:py-24">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Dúvidas frequentes</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[oklch(0.30_0.02_240)] mt-3 mb-4">
            Perguntas Frequentes
          </h2>
        </div>
        <div className="max-w-3xl mx-auto space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="font-semibold text-foreground pr-4">{faq.q}</span>
                {openIndex === i ? <ChevronUp className="h-5 w-5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
              </button>
              {openIndex === i && (
                <div className="px-5 pb-5 text-muted-foreground leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContatoSection() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [valorDivida, setValorDivida] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [lgpd, setLgpd] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const createLead = trpc.leads.create.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Formulário enviado com sucesso! Entraremos em contato em breve.");
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao enviar formulário. Tente novamente.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lgpd) {
      toast.error("Você precisa aceitar a política de privacidade.");
      return;
    }
    createLead.mutate({
      nome,
      email,
      telefone,
      cnpj: cnpj || undefined,
      valorDivida: valorDivida || undefined,
      mensagem: mensagem || undefined,
      lgpdConsent: 1,
    });
  };

  if (submitted) {
    return (
      <section id="contato" className="py-16 md:py-24 bg-[oklch(0.30_0.02_240)]">
        <div className="container">
          <div className="max-w-xl mx-auto text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="h-10 w-10 text-green-400" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">Recebemos seu contato!</h2>
            <p className="text-white/70 text-lg">
              Nossa equipe de especialistas analisará seu caso e entrará em contato em até 24 horas úteis. Fique atento ao seu e-mail e telefone.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="contato" className="py-16 md:py-24 bg-[oklch(0.30_0.02_240)]">
      <div className="container">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Fale conosco</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white mt-3 mb-4">
              Solicite uma Análise Gratuita do Seu Caso
            </h2>
            <p className="text-white/70 leading-relaxed mb-8">
              Preencha o formulário ao lado e um de nossos especialistas entrará em contato para analisar sua notificação PARR e apresentar as melhores estratégias de defesa.
            </p>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-[oklch(0.62_0.12_185)]" />
                </div>
                <div>
                  <div className="text-white font-medium">WhatsApp</div>
                  <div className="text-white/60 text-sm">Atendimento rápido e sigiloso</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-[oklch(0.62_0.12_185)]" />
                </div>
                <div>
                  <div className="text-white font-medium">contato@primetax.com.br</div>
                  <div className="text-white/60 text-sm">Resposta em até 24h</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-[oklch(0.62_0.12_185)]" />
                </div>
                <div>
                  <div className="text-white font-medium">Urgente?</div>
                  <div className="text-white/60 text-sm">Análise prioritária para prazos curtos</div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-xl">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome Completo *</label>
                <Input placeholder="Seu nome completo" value={nome} onChange={(e) => setNome(e.target.value)} required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">E-mail *</label>
                  <Input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Telefone *</label>
                  <Input placeholder="(00) 00000-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">CNPJ da Empresa</label>
                  <Input placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Valor da Dívida (aprox.)</label>
                  <Input placeholder="R$ 0,00" value={valorDivida} onChange={(e) => setValorDivida(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Breve relato do caso</label>
                <Textarea placeholder="Descreva brevemente sua situação..." value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} />
              </div>
              <div className="flex items-start gap-3">
                <Checkbox id="lgpd" checked={lgpd} onCheckedChange={(v) => setLgpd(v === true)} className="mt-0.5" />
                <label htmlFor="lgpd" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  Concordo com a Política de Privacidade e autorizo o tratamento dos meus dados pessoais para fins de contato comercial, conforme a LGPD (Lei 13.709/2018).
                </label>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full bg-[oklch(0.62_0.12_185)] hover:bg-[oklch(0.55_0.12_185)] text-white font-bold text-lg py-6"
                disabled={createLead.isPending}
              >
                {createLead.isPending ? "Enviando..." : "Solicitar Análise Gratuita"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Seus dados estão protegidos. Não compartilhamos informações com terceiros.
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[oklch(0.15_0.04_250)] py-10">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center">
            <img src={LOGO_FULL} alt="PrimeTax Solutions" className="h-8 opacity-60 brightness-200" />
          </div>
          <p className="text-white/40 text-sm text-center">
            &copy; {new Date().getFullYear()} Primetax Consultoria Tributária. Todos os direitos reservados.
          </p>
          <div className="flex gap-4">
            <a href="/dashboard" className="text-white/40 hover:text-white/60 text-sm">Área Administrativa</a>
            <a href="#" className="text-white/40 hover:text-white/60 text-sm">Política de Privacidade</a>
            <a href="#" className="text-white/40 hover:text-white/60 text-sm">Termos de Uso</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function VideoSection() {
  const { data: settings } = trpc.settings.get.useQuery(undefined, { retry: false });
  const videoUrl = settings?.videoUrl;

  if (!videoUrl) return null;

  // Convert YouTube URL to embed URL
  const getEmbedUrl = (url: string) => {
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return url;
  };

  return (
    <section className="py-16 md:py-24 bg-[oklch(0.30_0.02_240)]">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <span className="text-sm font-semibold text-[oklch(0.62_0.12_185)] uppercase tracking-wider">Assista e entenda</span>
          <h2 className="text-3xl md:text-4xl font-bold text-white mt-3 mb-4">
            Entenda o PARR em Poucos Minutos
          </h2>
          <p className="text-lg text-white/70 leading-relaxed">
            Nosso especialista explica de forma clara e objetiva como funciona o procedimento e o que você pode fazer para se proteger.
          </p>
        </div>
        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ paddingBottom: "56.25%" }}>
            <iframe
              src={getEmbedUrl(videoUrl)}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="V\u00eddeo explicativo sobre o PARR"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <StatsBar />
      <ProblemaSection />
      <VideoSection />
      <ConsequenciasSection />
      <FalhasLegaisSection />
      <ServicosSection />
      <InstitucionalSection />
      <DepoimentosSection />
      <FAQSection />
      <ContatoSection />
      <Footer />
    </div>
  );
}
