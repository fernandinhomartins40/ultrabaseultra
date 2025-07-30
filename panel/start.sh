#!/bin/bash

echo "=========================================="
echo "    SUPABASE MANAGER PANEL"
echo "=========================================="
echo

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "[ERRO] Node.js não encontrado! Instale Node.js primeiro."
    exit 1
fi

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "[INFO] Instalando dependências..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERRO] Falha ao instalar dependências!"
        exit 1
    fi
fi

# Definir IP padrão se não estiver configurado
if [ -z "$VPS_IP" ]; then
    export VPS_IP="localhost"
    echo "[AVISO] VPS_IP não configurado. Usando localhost."
    echo "[INFO] Para configurar: export VPS_IP=seu.ip.da.vps"
    echo
fi

echo "[INFO] Iniciando Supabase Manager Panel..."
echo "[INFO] VPS IP: $VPS_IP"
echo "[INFO] Painel: http://localhost:3030"
echo
echo "[CTRL+C] para parar o servidor"
echo "=========================================="

# Iniciar o servidor
npm start