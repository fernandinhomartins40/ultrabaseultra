@echo off
echo ==========================================
echo    SUPABASE MANAGER PANEL
echo ==========================================
echo.

REM Verificar se Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js não encontrado! Instale Node.js primeiro.
    pause
    exit /b 1
)

REM Verificar se as dependências estão instaladas
if not exist "node_modules" (
    echo [INFO] Instalando dependências...
    npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependências!
        pause
        exit /b 1
    )
)

REM Definir IP padrão se não estiver configurado
if "%VPS_IP%"=="" (
    set VPS_IP=localhost
    echo [AVISO] VPS_IP não configurado. Usando localhost.
    echo [INFO] Para configurar: set VPS_IP=seu.ip.da.vps
    echo.
)

echo [INFO] Iniciando Supabase Manager Panel...
echo [INFO] VPS IP: %VPS_IP%
echo [INFO] Painel: http://localhost:3030
echo.
echo [CTRL+C] para parar o servidor
echo ==========================================

REM Iniciar o servidor
npm start