@echo off
setlocal enabledelayedexpansion

REM Deploy manual para VPS - Supabase Manager (Windows)
REM Uso: deploy-manual.bat [VPS_PASSWORD]

set VPS_HOST=82.25.69.57
set VPS_USER=root

if "%1"=="" (
    if "%VPS_PASSWORD%"=="" (
        echo ❌ Erro: Senha da VPS nao fornecida
        echo Uso: deploy-manual.bat [VPS_PASSWORD]
        echo ou defina a variavel: set VPS_PASSWORD=sua_senha
        pause
        exit /b 1
    )
    set VPS_PASSWORD=%VPS_PASSWORD%
) else (
    set VPS_PASSWORD=%1
)

echo ==========================================
echo 🚀 DEPLOY MANUAL - SUPABASE MANAGER
echo ==========================================
echo 🖥️  VPS: %VPS_USER%@%VPS_HOST%
echo 📁 Local: %CD%
echo ⏰ %DATE% %TIME%
echo.

REM Verificar se sshpass está disponível (via WSL ou instalado)
where sshpass >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ sshpass nao encontrado.
    echo.
    echo Opcoes para Windows:
    echo 1. Instalar via WSL: wsl --install
    echo 2. Usar PuTTY/PSCP
    echo 3. Usar PowerShell com SSH
    echo.
    echo Tentando usar ssh nativo do Windows...
    
    REM Verificar se ssh está disponível
    where ssh >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ SSH nao encontrado. Instale OpenSSH ou WSL.
        pause
        exit /b 1
    )
    
    echo ⚠️  ATENCAO: Você precisará inserir a senha manualmente para cada comando.
    pause
    
    REM Usar ssh nativo (sem sshpass)
    set SSH_CMD=ssh -o StrictHostKeyChecking=no %VPS_USER%@%VPS_HOST%
    set SCP_CMD=scp -o StrictHostKeyChecking=no -r
) else (
    REM Usar sshpass
    set SSH_CMD=sshpass -p "%VPS_PASSWORD%" ssh -o StrictHostKeyChecking=no %VPS_USER%@%VPS_HOST%
    set SCP_CMD=sshpass -p "%VPS_PASSWORD%" scp -o StrictHostKeyChecking=no -r
)

echo 🔍 Testando conexao SSH...
%SSH_CMD% "echo 'Conexao SSH estabelecida'"
if %errorlevel% neq 0 (
    echo ❌ Falha na conexao SSH
    pause
    exit /b 1
)

echo.
echo 📦 Verificando se os arquivos existem...
if not exist "panel" (
    echo ❌ Diretorio 'panel' nao encontrado. Execute a partir da raiz do projeto.
    pause
    exit /b 1
)

if not exist "docker" (
    echo ❌ Diretorio 'docker' nao encontrado. Execute a partir da raiz do projeto.
    pause
    exit /b 1
)

echo.
echo 📦 Instalando dependencias na VPS...
%SSH_CMD% "apt-get update && apt-get install -y curl wget"

echo 🐳 Instalando Docker...
%SSH_CMD% "if ! command -v docker ^&^> /dev/null; then curl -fsSL https://get.docker.com -o get-docker.sh ^&^& sh get-docker.sh ^&^& systemctl start docker ^&^& systemctl enable docker; else echo 'Docker ja instalado'; fi"

echo 🟢 Instalando Node.js...
%SSH_CMD% "if ! command -v node ^&^> /dev/null; then curl -fsSL https://deb.nodesource.com/setup_18.x ^| bash - ^&^& apt-get install -y nodejs ^&^& npm install -g pm2; else echo 'Node.js ja instalado'; fi"

echo 🌐 Instalando nginx...
%SSH_CMD% "if ! command -v nginx ^&^> /dev/null; then apt-get install -y nginx ^&^& systemctl enable nginx; else echo 'nginx ja instalado'; fi"

echo.
echo 📁 Criando estrutura de diretorios...
%SSH_CMD% "mkdir -p /opt/supabase-manager/panel && mkdir -p /opt/supabase-manager/docker && mkdir -p /opt/supabase-manager/logs"

echo.
echo 📤 Copiando arquivos...
echo    📋 Panel...
%SCP_CMD% panel/* %VPS_USER%@%VPS_HOST%:/opt/supabase-manager/panel/

echo    🐳 Docker...
%SCP_CMD% docker/* %VPS_USER%@%VPS_HOST%:/opt/supabase-manager/docker/

echo.
echo 📦 Instalando dependencias do Node.js...
%SSH_CMD% "cd /opt/supabase-manager/panel && npm install --production"

echo.
echo ⚙️ Configurando PM2...
%SSH_CMD% "cat > /opt/supabase-manager/ecosystem.config.js << 'EOF'%newline%module.exports = {%newline%  apps: [{%newline%    name: 'supabase-manager',%newline%    script: './panel/server.js',%newline%    cwd: '/opt/supabase-manager',%newline%    instances: 1,%newline%    autorestart: true,%newline%    watch: false,%newline%    env: {%newline%      NODE_ENV: 'production',%newline%      VPS_IP: '%VPS_HOST%',%newline%      PORT: 3030%newline%    }%newline%  }]%newline%}%newline%EOF"

echo.
echo 🌐 Configurando nginx...
%SSH_CMD% "rm -f /etc/nginx/sites-enabled/default && systemctl restart nginx"

echo.
echo 🔥 Configurando firewall...
%SSH_CMD% "ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 3030/tcp && ufw allow 8010:8099/tcp && echo 'y' | ufw enable || true"

echo.
echo 🚀 Iniciando servicos...
%SSH_CMD% "cd /opt/supabase-manager && pm2 start ecosystem.config.js && pm2 save && systemctl restart nginx"

echo.
echo 🔍 Verificando deployment...
%SSH_CMD% "sleep 3 && pm2 status && curl -s -o /dev/null -w 'Status HTTP: %%{http_code}' http://localhost:3030/"

echo.
echo ===========================================
echo 🎉 DEPLOYMENT CONCLUIDO!
echo ===========================================
echo.
echo 📱 Acessos:
echo    🌐 Painel: http://%VPS_HOST%
echo    🎛️  Direto: http://%VPS_HOST%:3030
echo.
echo 🔧 Para monitorar:
echo    ssh %VPS_USER%@%VPS_HOST%
echo    pm2 logs supabase-manager
echo.
echo ===========================================

pause