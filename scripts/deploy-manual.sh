#!/bin/bash

# Deploy manual para VPS - Supabase Manager
# Uso: ./deploy-manual.sh [VPS_PASSWORD]

set -e

VPS_HOST="82.25.69.57"
VPS_USER="root"
VPS_PASSWORD="${1:-$VPS_PASSWORD}"

if [ -z "$VPS_PASSWORD" ]; then
    echo "❌ Erro: Senha da VPS não fornecida"
    echo "Uso: ./deploy-manual.sh [VPS_PASSWORD]"
    echo "ou defina a variável: export VPS_PASSWORD=sua_senha"
    exit 1
fi

echo "=========================================="
echo "🚀 DEPLOY MANUAL - SUPABASE MANAGER"
echo "=========================================="
echo "🖥️  VPS: $VPS_USER@$VPS_HOST"
echo "📁 Local: $(pwd)"
echo "⏰ $(date)"
echo ""

# Verificar se sshpass está instalado
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass não encontrado. Instalando..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y sshpass
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install hudochenkov/sshpass/sshpass
    else
        echo "❌ Sistema não suportado. Instale sshpass manualmente."
        exit 1
    fi
fi

# Função para executar comando na VPS
run_vps() {
    sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST "$1"
}

# Função para copiar arquivos para VPS
copy_to_vps() {
    sshpass -p "$VPS_PASSWORD" scp -o StrictHostKeyChecking=no -r "$1" $VPS_USER@$VPS_HOST:"$2"
}

echo "🔍 Testando conexão SSH..."
run_vps "echo '✅ Conexão SSH estabelecida'"

echo ""
echo "📦 Instalando dependências na VPS..."

# Instalar Docker
echo "🐳 Verificando Docker..."
run_vps "
if ! command -v docker &> /dev/null; then
    echo 'Instalando Docker...'
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl start docker
    systemctl enable docker
    usermod -aG docker $VPS_USER
else
    echo '✅ Docker já instalado: $(docker --version)'
fi
"

# Instalar Node.js
echo "🟢 Verificando Node.js..."
run_vps "
if ! command -v node &> /dev/null; then
    echo 'Instalando Node.js 18...'
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    npm install -g pm2
else
    echo '✅ Node.js já instalado: $(node --version)'
fi
"

# Instalar nginx
echo "🌐 Verificando nginx..."
run_vps "
if ! command -v nginx &> /dev/null; then
    echo 'Instalando nginx...'
    apt-get update
    apt-get install -y nginx
    systemctl enable nginx
else
    echo '✅ nginx já instalado: $(nginx -v 2>&1)'
fi
"

echo ""
echo "📁 Criando estrutura de diretórios..."
run_vps "
mkdir -p /opt/supabase-manager/panel
mkdir -p /opt/supabase-manager/docker
mkdir -p /opt/supabase-manager/logs
"

echo ""
echo "📤 Copiando arquivos..."

# Verificar se os diretórios existem
if [ ! -d "panel" ]; then
    echo "❌ Diretório 'panel' não encontrado. Execute a partir da raiz do projeto."
    exit 1
fi

if [ ! -d "docker" ]; then
    echo "❌ Diretório 'docker' não encontrado. Execute a partir da raiz do projeto."
    exit 1
fi

echo "   📋 Panel..."
copy_to_vps "panel/*" "/opt/supabase-manager/panel/"

echo "   🐳 Docker..."
copy_to_vps "docker/*" "/opt/supabase-manager/docker/"

echo ""
echo "📦 Instalando dependências do Node.js..."
run_vps "
cd /opt/supabase-manager/panel
npm install --production --silent
"

echo ""
echo "⚙️ Configurando serviços..."

# Criar arquivo de configuração do PM2
run_vps "
cat > /opt/supabase-manager/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'supabase-manager',
    script: './panel/server.js',
    cwd: '/opt/supabase-manager',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      VPS_IP: '$VPS_HOST',
      PORT: 3030
    },
    error_file: '/opt/supabase-manager/logs/error.log',
    out_file: '/opt/supabase-manager/logs/out.log',
    log_file: '/opt/supabase-manager/logs/combined.log'
  }]
}
EOF
"

# Configurar nginx
echo "🌐 Configurando nginx..."
run_vps "
cat > /etc/nginx/sites-available/supabase-manager << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $VPS_HOST _;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection \"1; mode=block\";
    
    # Supabase Manager Panel
    location / {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # Status page
    location /health {
        access_log off;
        return 200 'healthy';
        add_header Content-Type text/plain;
    }
}

# Configuração para instâncias Supabase
server {
    listen 8000-8099;
    listen [::]:8000-8099;
    
    location / {
        proxy_pass http://localhost:\\\$server_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

# Desabilitar site padrão e habilitar nosso
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/supabase-manager /etc/nginx/sites-enabled/

# Testar configuração
nginx -t
"

# Configurar firewall
echo "🔥 Configurando firewall..."
run_vps "
# Resetar regras UFW
ufw --force reset

# Regras básicas
ufw default deny incoming
ufw default allow outgoing

# Permitir SSH
ufw allow 22/tcp

# Permitir HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Permitir Supabase Manager
ufw allow 3030/tcp

# Permitir portas das instâncias Supabase
ufw allow 8010:8099/tcp   # Kong HTTP
ufw allow 8410:8499/tcp   # Kong HTTPS
ufw allow 5410:5499/tcp   # PostgreSQL external
ufw allow 4010:4099/tcp   # Analytics

# Habilitar firewall
echo 'y' | ufw enable
"

echo ""
echo "🚀 Iniciando serviços..."

# Parar serviços se estiverem rodando
run_vps "
pm2 stop supabase-manager 2>/dev/null || true
pm2 delete supabase-manager 2>/dev/null || true
"

# Iniciar com PM2
run_vps "
cd /opt/supabase-manager
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

# Reiniciar nginx
systemctl restart nginx
"

echo ""
echo "✅ Verificando deployment..."
run_vps "
sleep 5

echo '📊 Status dos serviços:'
echo '========================'
pm2 status
echo ''
systemctl status nginx --no-pager -l
echo ''

echo '🌐 Testando aplicação:'
echo '======================'
curl -s -o /dev/null -w 'Status: %{http_code}\\n' http://localhost:3030/ || echo 'Erro ao conectar'

echo ''
echo '🔥 Status do firewall:'
echo '====================='
ufw status
"

echo ""
echo "==========================================="
echo "🎉 DEPLOYMENT CONCLUÍDO COM SUCESSO!"
echo "==========================================="
echo ""
echo "📱 Acessos:"
echo "   🌐 Painel: http://$VPS_HOST"
echo "   🎛️  Direto: http://$VPS_HOST:3030"
echo ""
echo "🔧 Comandos úteis na VPS:"
echo "   ssh $VPS_USER@$VPS_HOST"
echo "   pm2 status"
echo "   pm2 logs supabase-manager"
echo "   pm2 restart supabase-manager"
echo ""
echo "📁 Arquivos:"
echo "   /opt/supabase-manager/"
echo "==========================================="