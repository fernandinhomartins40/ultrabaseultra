#!/bin/bash

# Script de Diagnóstico Completo - Supabase Manager
# Identifica problemas na criação de instâncias

echo "=========================================="
echo "🔍 DIAGNÓSTICO ULTRABASE SUPABASE MANAGER"
echo "=========================================="
echo "$(date)"
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Função para verificar comando
check_command() {
    if command -v "$1" &> /dev/null; then
        log_success "$1 está disponível: $(command -v $1)"
        return 0
    else
        log_error "$1 não está disponível"
        return 1
    fi
}

# 1. VERIFICAR DEPENDÊNCIAS
echo "1️⃣  VERIFICANDO DEPENDÊNCIAS"
echo "================================"

DOCKER_OK=false
COMPOSE_OK=false
OPENSSL_OK=false
BASH_OK=false

if check_command "docker"; then
    DOCKER_VERSION=$(docker --version 2>/dev/null)
    log_info "Docker version: $DOCKER_VERSION"
    DOCKER_OK=true
fi

if check_command "docker-compose" || docker compose version &>/dev/null; then
    if docker compose version &>/dev/null; then
        COMPOSE_VERSION=$(docker compose version 2>/dev/null)
        log_info "Docker Compose version: $COMPOSE_VERSION"
    else
        COMPOSE_VERSION=$(docker-compose --version 2>/dev/null)
        log_info "Docker Compose version: $COMPOSE_VERSION"
    fi
    COMPOSE_OK=true
fi

if check_command "openssl"; then
    OPENSSL_VERSION=$(openssl version 2>/dev/null)
    log_info "OpenSSL version: $OPENSSL_VERSION"
    OPENSSL_OK=true
fi

if check_command "bash"; then
    BASH_VERSION=$(bash --version | head -1)
    log_info "Bash version: $BASH_VERSION"
    BASH_OK=true
fi

echo ""

# 2. VERIFICAR ESTRUTURA DE ARQUIVOS
echo "2️⃣  VERIFICANDO ESTRUTURA DE ARQUIVOS"
echo "===================================="

# Navegar para diretório correto
if [ -d "docker" ]; then
    cd docker
elif [ -d "../docker" ]; then
    cd ../docker
else
    log_error "Diretório docker não encontrado!"
    echo "Estrutura atual:"
    ls -la
    exit 1
fi

log_info "Verificando no diretório: $(pwd)"

# Verificar arquivos essenciais
FILES_OK=true

if [ -f "generate.bash" ]; then
    log_success "generate.bash encontrado"
    if [ -x "generate.bash" ]; then
        log_success "generate.bash é executável"
    else
        log_warning "generate.bash não é executável - corrigindo..."
        chmod +x generate.bash
    fi
else
    log_error "generate.bash não encontrado!"
    FILES_OK=false
fi

if [ -f ".env.template" ]; then
    log_success ".env.template encontrado"
else
    log_error ".env.template não encontrado!"
    FILES_OK=false
fi

if [ -f "docker-compose.yml" ]; then
    log_success "docker-compose.yml encontrado"
else
    log_error "docker-compose.yml não encontrado!"
    FILES_OK=false
fi

if [ -d "volumes" ]; then
    log_success "diretório volumes/ encontrado"
    echo "   Conteúdo volumes/:"
    ls -la volumes/ | sed 's/^/   /'
else
    log_error "diretório volumes/ não encontrado!"
    FILES_OK=false
fi

echo ""

# 3. TESTAR CRIAÇÃO MANUAL
echo "3️⃣  TESTANDO CRIAÇÃO MANUAL"
echo "========================="

if [ "$DOCKER_OK" = true ] && [ "$COMPOSE_OK" = true ] && [ "$FILES_OK" = true ]; then
    log_info "Executando teste de criação manual..."
    
    # Backup de arquivos existentes
    if ls docker-compose-* 1> /dev/null 2>&1; then
        log_warning "Arquivos de instância existentes encontrados - fazendo backup"
        mkdir -p backup-$(date +%s)
        mv docker-compose-* .env-* volumes-* backup-$(date +%s)/ 2>/dev/null || true
    fi
    
    # Executar script com timeout
    log_info "Executando: timeout 300s bash generate.bash"
    
    if timeout 300s bash generate.bash > ../test-creation.log 2>&1; then
        log_success "Script executado com sucesso!"
        
        # Verificar arquivos gerados
        INSTANCE_FILES=$(ls -1 docker-compose-* 2>/dev/null | wc -l)
        ENV_FILES=$(ls -1 .env-* 2>/dev/null | wc -l)
        VOLUME_DIRS=$(ls -1d volumes-* 2>/dev/null | wc -l)
        
        log_info "Arquivos gerados:"
        echo "   - Compose files: $INSTANCE_FILES"
        echo "   - Env files: $ENV_FILES"
        echo "   - Volume dirs: $VOLUME_DIRS"
        
        if [ "$INSTANCE_FILES" -gt 0 ] && [ "$ENV_FILES" -gt 0 ] && [ "$VOLUME_DIRS" -gt 0 ]; then
            log_success "Todos os arquivos foram gerados corretamente!"
            
            # Verificar containers
            if [ "$DOCKER_OK" = true ]; then
                log_info "Verificando containers criados..."
                CONTAINERS=$(docker ps --format "table {{.Names}}" | grep supabase | wc -l)
                if [ "$CONTAINERS" -gt 0 ]; then
                    log_success "$CONTAINERS containers Supabase estão rodando"
                    docker ps --format "table {{.Names}}\t{{.Status}}" | grep supabase | sed 's/^/   /'
                else
                    log_warning "Nenhum container Supabase está rodando"
                fi
            fi
        else
            log_error "Arquivos não foram gerados corretamente"
        fi
        
    else
        log_error "Script falhou ou demorou mais de 5 minutos"
        echo ""
        log_info "Últimas 20 linhas do log:"
        tail -20 ../test-creation.log | sed 's/^/   /'
    fi
    
else
    log_error "Não é possível testar criação - dependências faltando"
fi

echo ""

# 4. VERIFICAR CONFIGURAÇÃO BACKEND
echo "4️⃣  VERIFICANDO CONFIGURAÇÃO BACKEND"
echo "=================================="

cd ..
if [ -f "panel/server.js" ]; then
    log_success "Backend server.js encontrado"
    
    # Verificar como o script está sendo chamado
    if grep -q "spawn.*generate.bash" panel/server.js; then
        log_info "Backend está configurado para chamar generate.bash"
        
        # Mostrar a linha relevante
        echo "   Configuração atual:"
        grep -n "spawn.*generate.bash" panel/server.js | sed 's/^/   /'
    else
        log_warning "Backend pode não estar configurado corretamente para chamar generate.bash"
    fi
    
    # Verificar logs
    if grep -q "console.log\|console.error" panel/server.js; then
        log_info "Sistema de logs básico encontrado"
    else
        log_warning "Sistema de logs pode estar insuficiente"
    fi
    
else
    log_error "Backend server.js não encontrado!"
fi

echo ""

# 5. RESUMO E RECOMENDAÇÕES
echo "5️⃣  RESUMO E RECOMENDAÇÕES"
echo "========================"

echo "📊 Status das Dependências:"
[ "$DOCKER_OK" = true ] && echo "   ✅ Docker" || echo "   ❌ Docker"
[ "$COMPOSE_OK" = true ] && echo "   ✅ Docker Compose" || echo "   ❌ Docker Compose"
[ "$OPENSSL_OK" = true ] && echo "   ✅ OpenSSL" || echo "   ✅ OpenSSL"
[ "$BASH_OK" = true ] && echo "   ✅ Bash" || echo "   ❌ Bash"
[ "$FILES_OK" = true ] && echo "   ✅ Arquivos" || echo "   ❌ Arquivos"

echo ""
echo "🎯 Próximos Passos:"

if [ "$DOCKER_OK" = false ]; then
    echo "   1. INSTALAR DOCKER:"
    echo "      - Linux: curl -fsSL https://get.docker.com | sh"
    echo "      - Windows: Docker Desktop"
    echo "      - Mac: Docker Desktop"
fi

if [ "$COMPOSE_OK" = false ]; then
    echo "   2. INSTALAR DOCKER COMPOSE:"
    echo "      - Geralmente vem com Docker Desktop"
    echo "      - Linux: apt-get install docker-compose-plugin"
fi

if [ "$FILES_OK" = false ]; then
    echo "   3. CORRIGIR ESTRUTURA DE ARQUIVOS:"
    echo "      - Verificar se todos os templates estão presentes"
    echo "      - Conferir permissões de execução"
fi

echo "   4. TESTAR CRIAÇÃO VIA BACKEND:"
echo "      - npm start (no diretório panel/)"
echo "      - Acessar http://localhost:3030"
echo "      - Tentar criar uma instância"

echo ""
echo "📝 Log completo salvo em: test-creation.log"
echo ""
echo "=========================================="
echo "🏁 DIAGNÓSTICO CONCLUÍDO"
echo "=========================================="