const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3030;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurações
const DOCKER_PATH = path.join(__dirname, '..', 'docker');
const DATA_FILE = path.join(__dirname, 'data', 'instances.json');
const IP_VPS = process.env.VPS_IP || '82.25.69.57'; // IP da VPS em produção

// Pool de portas disponíveis
const PORT_RANGES = {
  kong_http: { start: 8010, end: 8099 },
  kong_https: { start: 8410, end: 8499 },
  postgres_ext: { start: 5410, end: 5499 },
  analytics: { start: 4010, end: 4099 }
};

// Inicializar arquivo de dados
async function initializeData() {
  try {
    await fs.ensureDir(path.dirname(DATA_FILE));
    if (!await fs.pathExists(DATA_FILE)) {
      await fs.writeJson(DATA_FILE, { instances: [] });
    }
  } catch (error) {
    console.error('Erro ao inicializar dados:', error);
  }
}

// Carregar instâncias
async function loadInstances() {
  try {
    const data = await fs.readJson(DATA_FILE);
    return data.instances || [];
  } catch (error) {
    console.error('Erro ao carregar instâncias:', error);
    return [];
  }
}

// Salvar instâncias
async function saveInstances(instances) {
  try {
    await fs.writeJson(DATA_FILE, { instances });
  } catch (error) {
    console.error('Erro ao salvar instâncias:', error);
  }
}

// Gerar porta livre
function getAvailablePort(range, usedPorts) {
  for (let port = range.start; port <= range.end; port++) {
    if (!usedPorts.includes(port)) {
      return port;
    }
  }
  throw new Error(`Nenhuma porta disponível no range ${range.start}-${range.end}`);
}

// Gerar JWT único
function generateJWT() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

// Verificar status do container
function checkContainerStatus(instanceId) {
  return new Promise((resolve) => {
    exec(`docker ps --filter "name=supabase-studio-${instanceId}" --format "table {{.Status}}"`, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve('stopped');
      } else {
        const lines = stdout.trim().split('\n');
        if (lines.length > 1 && lines[1].includes('Up')) {
          resolve('running');
        } else {
          resolve('stopped');
        }
      }
    });
  });
}

// Rotas da API

// Listar instâncias
app.get('/api/instances', async (req, res) => {
  try {
    const instances = await loadInstances();
    
    // Verificar status de cada instância
    for (let instance of instances) {
      instance.status = await checkContainerStatus(instance.id);
    }
    
    await saveInstances(instances);
    res.json({ instances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar nova instância
app.post('/api/instances', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }
    
    const instances = await loadInstances();
    
    // Verificar se nome já existe
    if (instances.find(i => i.name.toLowerCase() === name.toLowerCase().trim())) {
      return res.status(400).json({ error: 'Nome do projeto já existe' });
    }
    
    // Gerar portas únicas
    const usedPorts = {
      kong_http: instances.map(i => i.ports.kong_http),
      kong_https: instances.map(i => i.ports.kong_https),
      postgres_ext: instances.map(i => i.ports.postgres_ext),
      analytics: instances.map(i => i.ports.analytics)
    };
    
    const instanceId = Date.now().toString();
    const jwt_secret = generateJWT();
    
    const newInstance = {
      id: instanceId,
      name: name.trim(),
      status: 'creating',
      created_at: new Date().toISOString(),
      jwt_secret,
      ports: {
        kong_http: getAvailablePort(PORT_RANGES.kong_http, usedPorts.kong_http),
        kong_https: getAvailablePort(PORT_RANGES.kong_https, usedPorts.kong_https),
        postgres_ext: getAvailablePort(PORT_RANGES.postgres_ext, usedPorts.postgres_ext),
        analytics: getAvailablePort(PORT_RANGES.analytics, usedPorts.analytics)
      },
      urls: {
        studio: `http://${IP_VPS}:${getAvailablePort(PORT_RANGES.kong_http, usedPorts.kong_http)}`,
        api: `http://${IP_VPS}:${getAvailablePort(PORT_RANGES.kong_http, usedPorts.kong_http)}`
      }
    };
    
    instances.push(newInstance);
    await saveInstances(instances);
    
    // Executar generate.bash em background
    const createProcess = spawn('bash', [
      path.join(DOCKER_PATH, 'generate.bash')
    ], {
      cwd: DOCKER_PATH,
      env: {
        ...process.env,
        INSTANCE_ID: instanceId,
        JWT_SECRET: jwt_secret,
        KONG_HTTP_PORT: newInstance.ports.kong_http.toString(),
        KONG_HTTPS_PORT: newInstance.ports.kong_https.toString(),
        POSTGRES_PORT_EXT: newInstance.ports.postgres_ext.toString(),
        ANALYTICS_PORT: newInstance.ports.analytics.toString(),
        API_EXTERNAL_URL: `http://${IP_VPS}:${newInstance.ports.kong_http}`,
        SUPABASE_PUBLIC_URL: `http://${IP_VPS}:${newInstance.ports.kong_http}`,
        STUDIO_DEFAULT_PROJECT: name.trim()
      }
    });
    
    createProcess.on('close', async (code) => {
      const instances = await loadInstances();
      const instance = instances.find(i => i.id === instanceId);
      if (instance) {
        instance.status = code === 0 ? 'running' : 'error';
        await saveInstances(instances);
      }
    });
    
    res.json({ 
      message: 'Instância sendo criada...',
      instance: newInstance 
    });
    
  } catch (error) {
    console.error('Erro ao criar instância:', error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar instância
app.post('/api/instances/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const instances = await loadInstances();
    const instance = instances.find(i => i.id === id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    exec(`cd ${DOCKER_PATH} && docker compose -f docker-compose-${id}.yml --env-file .env-${id} up -d`, 
      (error, stdout, stderr) => {
        if (error) {
          console.error('Erro ao iniciar instância:', error);
          return res.status(500).json({ error: 'Erro ao iniciar instância' });
        }
        res.json({ message: 'Instância iniciada com sucesso' });
      }
    );
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Parar instância
app.post('/api/instances/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    const instances = await loadInstances();
    const instance = instances.find(i => i.id === id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    exec(`cd ${DOCKER_PATH} && docker compose -f docker-compose-${id}.yml --env-file .env-${id} down`, 
      (error, stdout, stderr) => {
        if (error) {
          console.error('Erro ao parar instância:', error);
          return res.status(500).json({ error: 'Erro ao parar instância' });
        }
        res.json({ message: 'Instância parada com sucesso' });
      }
    );
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deletar instância
app.delete('/api/instances/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const instances = await loadInstances();
    const instanceIndex = instances.findIndex(i => i.id === id);
    
    if (instanceIndex === -1) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    // Parar containers primeiro
    exec(`cd ${DOCKER_PATH} && docker compose -f docker-compose-${id}.yml --env-file .env-${id} down -v`, 
      async (error, stdout, stderr) => {
        try {
          // Remover arquivos da instância
          await fs.remove(path.join(DOCKER_PATH, `docker-compose-${id}.yml`));
          await fs.remove(path.join(DOCKER_PATH, `.env-${id}`));
          await fs.remove(path.join(DOCKER_PATH, `volumes-${id}`));
          
          // Remover da lista
          instances.splice(instanceIndex, 1);
          await saveInstances(instances);
          
          res.json({ message: 'Instância removida com sucesso' });
        } catch (cleanupError) {
          console.error('Erro na limpeza:', cleanupError);
          res.status(500).json({ error: 'Erro ao limpar arquivos da instância' });
        }
      }
    );
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inicializar e rodar servidor
async function startServer() {
  await initializeData();
  app.listen(PORT, () => {
    console.log(`🚀 Painel Supabase rodando em http://localhost:${PORT}`);
    console.log(`📋 Configure VPS_IP=${IP_VPS} para URLs corretas`);
  });
}

startServer().catch(console.error);