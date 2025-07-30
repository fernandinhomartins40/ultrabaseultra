# Supabase Manager Panel

Painel web para gerenciar múltiplas instâncias Supabase usando o script `generate.bash` existente.

## Funcionalidades

- ✅ **Interface Visual**: Idêntica ao Supabase Cloud
- ✅ **Criar Instâncias**: Usa o `generate.bash` sem modificações
- ✅ **Gerenciar Instâncias**: Start/Stop/Delete de projetos
- ✅ **Isolamento**: Cada instância com JWT único e portas isoladas
- ✅ **Acesso Direto**: Links para Studio de cada instância
- ✅ **Pool de Portas**: Sistema automático de portas únicas

## Como Usar

### 1. Instalar Dependências
```bash
cd panel
npm install
```

### 2. Configurar IP da VPS
```bash
# Linux/Mac
export VPS_IP=seu.ip.da.vps

# Windows
set VPS_IP=seu.ip.da.vps
```

### 3. Executar o Painel
```bash
npm start
# ou para desenvolvimento:
npm run dev
```

### 4. Acessar Interface
Abra: `http://localhost:3030`

## Como Funciona

### Estrutura de Portas
- **Kong HTTP**: 8010-8099
- **Kong HTTPS**: 8410-8499  
- **Postgres External**: 5410-5499
- **Analytics**: 4010-4099

### Fluxo de Criação
1. Usuário cria projeto via interface
2. Backend gera portas únicas e JWT exclusivo
3. Executa `generate.bash` com variáveis customizadas
4. Registra instância no sistema
5. Retorna URL de acesso ao Studio

### API Endpoints

#### GET `/api/instances`
Lista todas as instâncias com status atualizado

#### POST `/api/instances`
```json
{
  "name": "Nome do Projeto"
}
```

#### POST `/api/instances/:id/start`
Inicia uma instância parada

#### POST `/api/instances/:id/stop`
Para uma instância em execução

#### DELETE `/api/instances/:id`
Remove instância (containers + volumes + arquivos)

## Estrutura de Dados

```json
{
  "instances": [
    {
      "id": "1642095600",
      "name": "Meu App",
      "status": "running",
      "created_at": "2025-01-30T...",
      "jwt_secret": "unique-jwt-here",
      "ports": {
        "kong_http": 8010,
        "kong_https": 8410,
        "postgres_ext": 5410,
        "analytics": 4010
      },
      "urls": {
        "studio": "http://IP_VPS:8010",
        "api": "http://IP_VPS:8010"
      }
    }
  ]
}
```

## Configuração Kong

Cada instância usa:
- **User**: `admin`
- **Password**: `admin` (gerado automaticamente)
- **JWT**: Único por instância

## Arquivos Gerados

Para cada instância (`ID=123456`):
- `docker-compose-123456.yml`
- `.env-123456`
- `volumes-123456/` (dados isolados)

## Monitoramento

- Status atualizado a cada 30 segundos
- Verificação via `docker ps`
- Interface reativa com cores por status

## Compatibilidade

- ✅ Usa `generate.bash` original
- ✅ Mantém isolamento completo
- ✅ IPs da VPS em todas as configurações
- ✅ Kong com credenciais padrão
- ✅ Volumes separados por projeto