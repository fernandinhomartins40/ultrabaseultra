# 🚀 Deploy Guide - Supabase Manager

Guia completo para deploy do Supabase Manager na VPS `82.25.69.57`.

## 📋 Pré-requisitos

- VPS com Ubuntu/Debian
- Acesso SSH: `root@82.25.69.57`
- Senha da VPS definida na secret `VPS_PASSWORD`

## 🔧 Opções de Deploy

### 1. Deploy Automático (GitHub Actions) ⚡

**Mais Simples - Deploy automático a cada push**

1. **Configure a Secret no GitHub:**
   - Vá em: `Settings` → `Secrets and variables` → `Actions`
   - Adicione: `VPS_PASSWORD` = sua_senha_da_vps

2. **Push para main:**
   ```bash
   git add .
   git commit -m "Deploy Supabase Manager"
   git push origin main
   ```

3. **Acompanhe o deploy:**
   - Vá em: `Actions` no GitHub
   - Deploy automático executará
   - Acesse: `http://82.25.69.57`

### 2. Deploy Manual (Script) 🛠️

**Para desenvolvedores que preferem controle manual**

#### Linux/Mac:
```bash
# Navegar para raiz do projeto
cd ultrabaseultra

# Dar permissão
chmod +x scripts/deploy-manual.sh

# Executar com senha
./scripts/deploy-manual.sh sua_senha_da_vps

# Ou definir variável
export VPS_PASSWORD=sua_senha_da_vps
./scripts/deploy-manual.sh
```

#### Windows:
```batch
# Navegar para raiz do projeto
cd ultrabaseultra

# Executar
scripts\deploy-manual.bat sua_senha_da_vps

# Ou definir variável
set VPS_PASSWORD=sua_senha_da_vps
scripts\deploy-manual.bat
```

## 📊 O que o Deploy Instala

### Na VPS será instalado:
- ✅ **Docker** + Docker Compose
- ✅ **Node.js 18** + npm + PM2
- ✅ **nginx** (proxy reverso)
- ✅ **UFW Firewall** (configurado)

### Estrutura criada:
```
/opt/supabase-manager/
├── panel/              # Painel web  
├── docker/             # Scripts Supabase
├── logs/               # Logs do sistema
└── ecosystem.config.js # Config PM2
```

### Serviços configurados:
- **PM2**: `supabase-manager` (port 3030)
- **nginx**: Proxy + load balancer
- **UFW**: Firewall com portas abertas

## 🌐 URLs de Acesso

Após o deploy:

- **🎛️ Painel Principal**: `http://82.25.69.57`
- **📊 Painel Direto**: `http://82.25.69.57:3030`
- **🔧 Instâncias**: `http://82.25.69.57:8010-8099`

## 🔧 Comandos de Gerenciamento

### SSH na VPS:
```bash
ssh root@82.25.69.57
```

### Gerenciar Painel:
```bash
pm2 status                    # Status
pm2 logs supabase-manager     # Logs
pm2 restart supabase-manager  # Reiniciar
pm2 stop supabase-manager     # Parar
```

### Logs do Sistema:
```bash
tail -f /opt/supabase-manager/logs/combined.log
journalctl -u nginx -f
```

### Firewall:
```bash
ufw status              # Status
ufw allow 8100/tcp      # Adicionar porta
ufw reload              # Recarregar
```

## 🔍 Troubleshooting

### Painel não abre:
```bash
# Verificar se está rodando
pm2 status

# Ver logs de erro
pm2 logs supabase-manager --err

# Reiniciar
pm2 restart supabase-manager
```

### Instâncias não criam:
```bash
# Verificar Docker
docker ps
systemctl status docker

# Permissões
chmod +x /opt/supabase-manager/docker/generate.bash
```

### nginx não responde:
```bash
# Status
systemctl status nginx

# Testar config
nginx -t

# Reiniciar
systemctl restart nginx
```

### Firewall bloqueando:
```bash
# Ver regras
ufw status verbose

# Permitir porta
ufw allow 8050/tcp

# Recarregar
ufw reload
```

## 📋 Portas Utilizadas

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| nginx | 80 | Proxy principal |
| Panel | 3030 | Painel web |
| Kong HTTP | 8010-8099 | Instâncias Supabase |
| Kong HTTPS | 8410-8499 | SSL das instâncias |
| PostgreSQL | 5410-5499 | Acesso externo DB |
| Analytics | 4010-4099 | Logs/métricas |

## 🔄 Atualizar Deploy

### Automático:
1. Faça push para `main`
2. GitHub Actions executa automaticamente

### Manual:
```bash
# Re-executar script
./scripts/deploy-manual.sh sua_senha
```

## 📝 Logs Importantes

### Aplicação:
- `/opt/supabase-manager/logs/combined.log`
- `/opt/supabase-manager/logs/error.log`

### Sistema:
- `journalctl -u nginx`
- `pm2 logs supabase-manager`

## 🎯 Status Esperado

Após deploy bem-sucedido:

```bash
$ pm2 status
┌─────┬─────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id  │ name                │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├─────┼─────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0   │ supabase-manager    │ default     │ 1.0.0   │ fork    │ 1234     │ 5m     │ 0    │ online    │ 0%       │ 50MB     │ root     │ disabled │
└─────┴─────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘

$ curl http://82.25.69.57
<!DOCTYPE html>
<html lang="pt-BR">...
```

## 🚨 Troubleshooting Comum

1. **Senha SSH incorreta**: Verifique a secret `VPS_PASSWORD`
2. **Porta 22 bloqueada**: Firewall ou provider bloqueando SSH
3. **Sem Docker**: Script instala automaticamente
4. **Node.js não encontrado**: Script instala Node.js 18
5. **Permissões**: Todos os arquivos são criados com permissões corretas

---

🎉 **Deploy concluído!** O Supabase Manager estará disponível em `http://82.25.69.57`