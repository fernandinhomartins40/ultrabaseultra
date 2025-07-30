#!/bin/bash

# Script para aplicar correções no Supabase Manager
# Resolve problemas de criação de instâncias

echo "🔧 APLICANDO CORREÇÕES - SUPABASE MANAGER"
echo "========================================"

# Verificar se estamos no diretório correto
if [ ! -f "panel/server.js" ]; then
    echo "❌ Execute este script da raiz do projeto (onde está o diretório panel/)"
    exit 1
fi

# 1. Backup do servidor original
echo "1️⃣  Fazendo backup do servidor original..."
cp panel/server.js panel/server-original.js
echo "✅ Backup salvo em panel/server-original.js"

# 2. Aplicar servidor corrigido
echo "2️⃣  Aplicando servidor corrigido..."
cp panel/server-fixed.js panel/server.js
echo "✅ Servidor corrigido aplicado"

# 3. Criar diretórios necessários
echo "3️⃣  Criando estrutura de diretórios..."
mkdir -p panel/data
mkdir -p panel/logs
echo "✅ Diretórios criados"

# 4. Garantir permissões do script
echo "4️⃣  Verificando permissões..."
if [ -f "docker/generate.bash" ]; then
    chmod +x docker/generate.bash
    echo "✅ Permissões do generate.bash verificadas"
else
    echo "⚠️  Script generate.bash não encontrado em docker/"
fi

# 5. Verificar dependências do Node.js
echo "5️⃣  Verificando dependências..."
cd panel

# Verificar se node_modules existe
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências do Node.js..."
    npm install
    echo "✅ Dependências instaladas"
else
    echo "✅ Dependências já instaladas"
fi

cd ..

# 6. Testar dependências do sistema
echo "6️⃣  Testando dependências do sistema..."

# Docker
if command -v docker &> /dev/null; then
    echo "✅ Docker: $(docker --version)"
else
    echo "❌ Docker não encontrado - instâncias não funcionarão!"
    echo "   Instale Docker: https://docs.docker.com/get-docker/"
fi

# Docker Compose
if docker compose version &> /dev/null; then
    echo "✅ Docker Compose: $(docker compose version)"
elif command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose: $(docker-compose --version)"
else
    echo "❌ Docker Compose não encontrado - instâncias não funcionarão!"
fi

# OpenSSL
if command -v openssl &> /dev/null; then
    echo "✅ OpenSSL: $(openssl version)"
else
    echo "⚠️ OpenSSL não encontrado - pode causar problemas na geração de senhas"
fi

echo ""
echo "🎯 CORREÇÕES APLICADAS COM SUCESSO!"
echo "================================="
echo ""
echo "📋 O que foi corrigido:"
echo "   ✅ Sistema de logging detalhado"
echo "   ✅ Validação pós-criação de instâncias"
echo "   ✅ Cleanup automático em caso de falha"
echo "   ✅ Verificação de pré-requisitos"
echo "   ✅ Timeout para criação (10 minutos)"
echo "   ✅ Captura completa de logs do script"
echo "   ✅ Endpoint de diagnóstico (/api/diagnostics)"
echo ""
echo "🚀 Para testar:"
echo "   cd panel && npm start"
echo "   Acesse: http://localhost:3030"
echo "   Diagnóstico: http://localhost:3030/api/diagnostics"
echo ""
echo "🔍 Para diagnóstico completo:"
echo "   ./scripts/diagnose.sh"
echo ""
echo "📊 Logs em tempo real:"
echo "   tail -f panel/logs/instances.log"