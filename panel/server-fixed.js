const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const util = require('util');

const app = express();
const PORT = 3030;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurações
const DOCKER_PATH = path.join(__dirname, '..', 'docker');
const DATA_FILE = path.join(__dirname, 'data', 'instances.json');
const LOG_FILE = path.join(__dirname, 'logs', 'instances.log');
const IP_VPS = process.env.VPS_IP || '82.25.69.57';

// Pool de portas disponíveis
const PORT_RANGES = {
  kong_http: { start: 8010, end: 8099 },
  kong_https: { start: 8410, end: 8499 },
  postgres_ext: { start: 5410, end: 5499 },
  analytics: { start: 4010, end: 4099 }
};

// Sistema de logging detalhado
const logger = {
  log: (level, message, instanceId = null, data = null) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      instanceId,
      data
    };
    
    const logLine = `${timestamp} [${level}] ${instanceId ? `[${instanceId}]` : '[system]'}: ${message}`;
    console.log(logLine);
    
    // Garantir que diretório de logs existe
    fs.ensureDirSync(path.dirname(LOG_FILE));
    
    // Escrever no arquivo de log
    fs.appendFileSync(LOG_FILE, logLine + '\n');
    
    if (data) {
      const dataLine = `${timestamp} [${level}] ${instanceId ? `[${instanceId}]` : '[system]'}: DATA: ${JSON.stringify(data)}`;
      fs.appendFileSync(LOG_FILE, dataLine + '\n');
    }
  },
  
  info: (message, instanceId, data) => logger.log('INFO', message, instanceId, data),
  warn: (message, instanceId, data) => logger.log('WARN', message, instanceId, data),
  error: (message, instanceId, data) => logger.log('ERROR', message, instanceId, data),
  debug: (message, instanceId, data) => logger.log('DEBUG', message, instanceId, data)
};

// Promisify exec para async/await
const execAsync = util.promisify(exec);

// Inicializar arquivo de dados
async function initializeData() {
  try {
    await fs.ensureDir(path.dirname(DATA_FILE));
    await fs.ensureDir(path.dirname(LOG_FILE));
    
    if (!await fs.pathExists(DATA_FILE)) {
      await fs.writeJson(DATA_FILE, { instances: [] });
      logger.info('Arquivo de dados inicializado');
    }
  } catch (error) {
    logger.error('Erro ao inicializar dados', null, { error: error.message });
  }
}

// Carregar instâncias
async function loadInstances() {
  try {
    const data = await fs.readJson(DATA_FILE);
    return data.instances || [];
  } catch (error) {
    logger.error('Erro ao carregar instâncias', null, { error: error.message });
    return [];
  }
}

// Salvar instâncias
async function saveInstances(instances) {
  try {
    await fs.writeJson(DATA_FILE, { instances });
    logger.debug('Instâncias salvas', null, { count: instances.length });
  } catch (error) {
    logger.error('Erro ao salvar instâncias', null, { error: error.message });
  }
}

// Verificar pré-requisitos
async function checkPrerequisites() {
  const checks = {
    docker: false,
    dockerCompose: false,
    generateScript: false,
    templates: false
  };
  
  try {
    // Verificar Docker
    await execAsync('docker --version');
    checks.docker = true;
    logger.info('Docker está disponível');
  } catch (error) {
    logger.error('Docker não está disponível', null, { error: error.message });
  }
  
  try {
    // Verificar Docker Compose
    try {
      await execAsync('docker compose version');
    } catch {
      await execAsync('docker-compose --version');
    }
    checks.dockerCompose = true;
    logger.info('Docker Compose está disponível');
  } catch (error) {
    logger.error('Docker Compose não está disponível', null, { error: error.message });
  }
  
  // Verificar script generate.bash
  const scriptPath = path.join(DOCKER_PATH, 'generate.bash');
  if (await fs.pathExists(scriptPath)) {
    checks.generateScript = true;
    logger.info('Script generate.bash encontrado');
    
    // Verificar se é executável
    try {
      await execAsync(`chmod +x "${scriptPath}"`);
      logger.info('Permissões do script verificadas');
    } catch (error) {
      logger.warn('Erro ao definir permissões do script', null, { error: error.message });
    }
  } else {
    logger.error('Script generate.bash não encontrado', null, { path: scriptPath });
  }
  
  // Verificar templates
  const templates = ['.env.template', 'docker-compose.yml'];
  checks.templates = true;
  
  for (const template of templates) {
    const templatePath = path.join(DOCKER_PATH, template);
    if (!await fs.pathExists(templatePath)) {
      checks.templates = false;
      logger.error(`Template ${template} não encontrado`, null, { path: templatePath });
    }
  }
  
  if (checks.templates) {
    logger.info('Todos os templates encontrados');
  }
  
  return checks;
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

// Verificar status do container com mais detalhes
async function checkContainerStatus(instanceId) {
  try {
    const { stdout } = await execAsync(`docker ps --filter "name=supabase-studio-${instanceId}" --format "{{.Status}}"`);
    
    if (!stdout.trim()) {
      return 'stopped';
    }
    
    if (stdout.includes('Up')) {
      return 'running';
    } else {
      return 'error';
    }
  } catch (error) {
    logger.debug('Erro ao verificar status do container', instanceId, { error: error.message });
    return 'stopped';
  }
}

// Validar se instância foi criada corretamente
async function validateInstanceCreation(instanceId, ports) {
  const validations = {
    files: false,
    containers: false,
    connectivity: false
  };
  
  try {
    // 1. Verificar se arquivos foram gerados
    const envFile = path.join(DOCKER_PATH, `.env-${instanceId}`);
    const composeFile = path.join(DOCKER_PATH, `docker-compose-${instanceId}.yml`);
    const volumeDir = path.join(DOCKER_PATH, `volumes-${instanceId}`);
    
    if (await fs.pathExists(envFile) && await fs.pathExists(composeFile) && await fs.pathExists(volumeDir)) {
      validations.files = true;
      logger.info('Arquivos de configuração criados', instanceId);
    } else {
      logger.error('Arquivos de configuração não foram criados', instanceId, {
        envFile: await fs.pathExists(envFile),
        composeFile: await fs.pathExists(composeFile),
        volumeDir: await fs.pathExists(volumeDir)
      });
    }
    
    // 2. Verificar se containers estão rodando (aguardar até 60 segundos)
    let containerAttempts = 0;
    const maxAttempts = 12; // 12 * 5s = 60s
    
    while (containerAttempts < maxAttempts) {
      try {
        const { stdout } = await execAsync(`docker ps --filter "name=supabase-.*-${instanceId}" --format "{{.Names}}"`);
        const containerCount = stdout.trim().split('\n').filter(line => line.trim()).length;
        
        if (containerCount >= 3) { // Pelo menos Studio, Kong e DB
          validations.containers = true;
          logger.info(`${containerCount} containers rodando`, instanceId);
          break;
        } else {
          logger.debug(`Apenas ${containerCount} containers rodando, aguardando...`, instanceId);
        }
      } catch (error) {
        logger.debug('Erro ao verificar containers', instanceId, { error: error.message });
      }
      
      containerAttempts++;
      if (containerAttempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar 5 segundos
      }
    }
    
    // 3. Testar conectividade HTTP (aguardar até 30 segundos)
    if (validations.containers) {
      let connectivityAttempts = 0;
      const maxConnectivityAttempts = 6; // 6 * 5s = 30s
      
      while (connectivityAttempts < maxConnectivityAttempts) {
        try {
          const response = await fetch(`http://${IP_VPS}:${ports.kong_http}`, {
            method: 'GET',
            timeout: 5000
          });
          
          if (response.ok || response.status === 401) { // 401 é esperado sem auth
            validations.connectivity = true;
            logger.info('Instância respondendo HTTP', instanceId, { status: response.status });
            break;
          }
        } catch (error) {
          logger.debug('Aguardando conectividade HTTP', instanceId, { attempt: connectivityAttempts + 1 });
        }
        
        connectivityAttempts++;
        if (connectivityAttempts < maxConnectivityAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
  } catch (error) {
    logger.error('Erro na validação da instância', instanceId, { error: error.message });
  }
  
  return validations;
}

// Cleanup de instância com falha
async function cleanupFailedInstance(instanceId) {
  logger.info('Iniciando cleanup de instância com falha', instanceId);
  
  try {
    // Parar e remover containers
    const composeFile = path.join(DOCKER_PATH, `docker-compose-${instanceId}.yml`);
    const envFile = path.join(DOCKER_PATH, `.env-${instanceId}`);
    
    if (await fs.pathExists(composeFile) && await fs.pathExists(envFile)) {
      try {
        await execAsync(`docker compose -f "${composeFile}" --env-file "${envFile}" down -v`, {
          cwd: DOCKER_PATH,
          timeout: 60000 // 60 segundos timeout
        });
        logger.info('Containers removidos', instanceId);
      } catch (error) {
        logger.warn('Erro ao remover containers', instanceId, { error: error.message });
      }
    }
    
    // Remover arquivos gerados
    const filesToRemove = [
      path.join(DOCKER_PATH, `.env-${instanceId}`),
      path.join(DOCKER_PATH, `docker-compose-${instanceId}.yml`),
      path.join(DOCKER_PATH, `volumes-${instanceId}`)
    ];
    
    for (const file of filesToRemove) {
      try {
        if (await fs.pathExists(file)) {
          await fs.remove(file);
          logger.debug('Arquivo removido', instanceId, { file });
        }
      } catch (error) {
        logger.warn('Erro ao remover arquivo', instanceId, { file, error: error.message });
      }
    }
    
    logger.info('Cleanup concluído', instanceId);
    
  } catch (error) {
    logger.error('Erro no cleanup', instanceId, { error: error.message });
  }
}

// Rota para diagnóstico
app.get('/api/diagnostics', async (req, res) => {
  logger.info('Executando diagnóstico do sistema');
  
  const checks = await checkPrerequisites();
  const instances = await loadInstances();
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    prerequisites: checks,
    instances: {
      total: instances.length,
      running: instances.filter(i => i.status === 'running').length,
      creating: instances.filter(i => i.status === 'creating').length,
      error: instances.filter(i => i.status === 'error').length
    },
    ports: {
      available: {
        kong_http: PORT_RANGES.kong_http.end - PORT_RANGES.kong_http.start + 1 - instances.length,
        kong_https: PORT_RANGES.kong_https.end - PORT_RANGES.kong_https.start + 1 - instances.length,
        postgres_ext: PORT_RANGES.postgres_ext.end - PORT_RANGES.postgres_ext.start + 1 - instances.length,
        analytics: PORT_RANGES.analytics.end - PORT_RANGES.analytics.start + 1 - instances.length
      }
    },
    system: {
      vps_ip: IP_VPS,
      docker_path: DOCKER_PATH,
      data_file: DATA_FILE,
      log_file: LOG_FILE
    }
  };
  
  res.json(diagnostics);
});

// Listar instâncias (rota original melhorada)
app.get('/api/instances', async (req, res) => {
  try {
    const instances = await loadInstances();
    
    // Verificar status de cada instância em paralelo
    const statusPromises = instances.map(async (instance) => {
      const status = await checkContainerStatus(instance.id);
      return { ...instance, status };
    });
    
    const updatedInstances = await Promise.all(statusPromises);
    await saveInstances(updatedInstances);
    
    res.json({ instances: updatedInstances });
  } catch (error) {
    logger.error('Erro ao listar instâncias', null, { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Criar nova instância (versão robusta)
app.post('/api/instances', async (req, res) => {
  const { name } = req.body;
  let instanceId = null;
  
  try {
    // Validações básicas
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }
    
    logger.info('Iniciando criação de instância', null, { name: name.trim() });
    
    // Verificar pré-requisitos
    const checks = await checkPrerequisites();
    if (!checks.docker || !checks.dockerCompose || !checks.generateScript || !checks.templates) {
      logger.error('Pré-requisitos não atendidos', null, { checks });
      return res.status(500).json({ 
        error: 'Sistema não está pronto para criar instâncias',
        details: checks
      });
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
    
    instanceId = Date.now().toString();
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
    
    logger.info('Configuração da instância gerada', instanceId, { 
      ports: newInstance.ports, 
      urls: newInstance.urls 
    });
    
    instances.push(newInstance);
    await saveInstances(instances);
    
    // Executar generate.bash com logging completo
    const scriptPath = path.join(DOCKER_PATH, 'generate.bash');
    const createProcess = spawn('bash', [scriptPath], {
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
      },
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    logger.info('Script generate.bash iniciado', instanceId);
    
    // Capturar logs do processo
    createProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logger.info(`[SCRIPT STDOUT]: ${output}`, instanceId);
      }
    });
    
    createProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logger.warn(`[SCRIPT STDERR]: ${output}`, instanceId);
      }
    });
    
    // Timeout de 10 minutos para criação
    const creationTimeout = setTimeout(() => {
      logger.error('Timeout na criação da instância (10 minutos)', instanceId);
      createProcess.kill('SIGKILL');
    }, 10 * 60 * 1000);
    
    createProcess.on('close', async (code) => {
      clearTimeout(creationTimeout);
      logger.info(`Script finalizado com código: ${code}`, instanceId);
      
      const instances = await loadInstances();
      const instance = instances.find(i => i.id === instanceId);
      
      if (instance) {
        if (code === 0) {
          logger.info('Validando criação da instância', instanceId);
          
          // Aguardar um pouco para containers estabilizarem
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          const validation = await validateInstanceCreation(instanceId, instance.ports);
          
          if (validation.files && validation.containers) {
            instance.status = 'running';
            logger.info('Instância criada com sucesso', instanceId, validation);
          } else {
            instance.status = 'error';
            logger.error('Validação da instância falhou', instanceId, validation);
            
            // Cleanup automático em caso de falha
            await cleanupFailedInstance(instanceId);
          }
        } else {
          instance.status = 'error';
          logger.error('Script falhou', instanceId, { exitCode: code });
          
          // Cleanup automático em caso de falha
          await cleanupFailedInstance(instanceId);
        }
        
        await saveInstances(instances);
      }
    });
    
    createProcess.on('error', async (error) => {
      clearTimeout(creationTimeout);
      logger.error('Erro no processo de criação', instanceId, { error: error.message });
      
      const instances = await loadInstances();
      const instance = instances.find(i => i.id === instanceId);
      if (instance) {
        instance.status = 'error';
        await saveInstances(instances);
      }
      
      await cleanupFailedInstance(instanceId);
    });
    
    res.json({ 
      message: 'Instância sendo criada...',
      instance: newInstance 
    });
    
  } catch (error) {
    logger.error('Erro ao criar instância', instanceId, { error: error.message });
    
    // Cleanup em caso de erro na configuração
    if (instanceId) {
      await cleanupFailedInstance(instanceId);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Iniciar instância
app.post('/api/instances/:id/start', async (req, res) => {
  const { id } = req.params;
  
  try {
    logger.info('Iniciando instância', id);
    
    const instances = await loadInstances();
    const instance = instances.find(i => i.id === id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    const composeFile = path.join(DOCKER_PATH, `docker-compose-${id}.yml`);
    const envFile = path.join(DOCKER_PATH, `.env-${id}`);
    
    if (!await fs.pathExists(composeFile) || !await fs.pathExists(envFile)) {
      logger.error('Arquivos de configuração não encontrados', id);
      return res.status(404).json({ error: 'Arquivos de configuração da instância não encontrados' });
    }
    
    const command = `docker compose -f "docker-compose-${id}.yml" --env-file ".env-${id}" up -d`;
    
    await execAsync(command, { cwd: DOCKER_PATH, timeout: 120000 });
    
    // Aguardar containers iniciarem
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const status = await checkContainerStatus(id);
    instance.status = status;
    await saveInstances(instances);
    
    logger.info('Instância iniciada', id, { status });
    res.json({ message: 'Instância iniciada com sucesso' });
    
  } catch (error) {
    logger.error('Erro ao iniciar instância', id, { error: error.message });
    res.status(500).json({ error: 'Erro ao iniciar instância: ' + error.message });
  }
});

// Parar instância
app.post('/api/instances/:id/stop', async (req, res) => {
  const { id } = req.params;
  
  try {
    logger.info('Parando instância', id);
    
    const instances = await loadInstances();
    const instance = instances.find(i => i.id === id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    const composeFile = path.join(DOCKER_PATH, `docker-compose-${id}.yml`);
    const envFile = path.join(DOCKER_PATH, `.env-${id}`);
    
    if (await fs.pathExists(composeFile) && await fs.pathExists(envFile)) {
      const command = `docker compose -f "docker-compose-${id}.yml" --env-file ".env-${id}" down`;
      await execAsync(command, { cwd: DOCKER_PATH, timeout: 60000 });
    }
    
    instance.status = 'stopped';
    await saveInstances(instances);
    
    logger.info('Instância parada', id);
    res.json({ message: 'Instância parada com sucesso' });
    
  } catch (error) {
    logger.error('Erro ao parar instância', id, { error: error.message });
    res.status(500).json({ error: 'Erro ao parar instância: ' + error.message });
  }
});

// Deletar instância
app.delete('/api/instances/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    logger.info('Deletando instância', id);
    
    const instances = await loadInstances();
    const instanceIndex = instances.findIndex(i => i.id === id);
    
    if (instanceIndex === -1) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    // Usar função de cleanup
    await cleanupFailedInstance(id);
    
    // Remover da lista
    instances.splice(instanceIndex, 1);
    await saveInstances(instances);
    
    logger.info('Instância deletada', id);
    res.json({ message: 'Instância removida com sucesso' });
    
  } catch (error) {
    logger.error('Erro ao deletar instância', id, { error: error.message });
    res.status(500).json({ error: 'Erro ao deletar instância: ' + error.message });
  }
});

// Rota para logs de uma instância específica
app.get('/api/instances/:id/logs', async (req, res) => {
  const { id } = req.params;
  const { lines = 100 } = req.query;
  
  try {
    logger.debug('Recuperando logs da instância', id);
    
    // Ler logs do arquivo principal
    if (await fs.pathExists(LOG_FILE)) {
      const logContent = await fs.readFile(LOG_FILE, 'utf8');
      const logLines = logContent.split('\n')
        .filter(line => line.includes(`[${id}]`))
        .slice(-parseInt(lines));
      
      res.json({ 
        instanceId: id,
        logs: logLines,
        totalLines: logLines.length
      });
    } else {
      res.json({ 
        instanceId: id,
        logs: [],
        totalLines: 0
      });
    }
    
  } catch (error) {
    logger.error('Erro ao recuperar logs', id, { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Inicializar e rodar servidor
async function startServer() {
  await initializeData();
  
  // Verificar pré-requisitos na inicialização
  const checks = await checkPrerequisites();
  logger.info('Pré-requisitos verificados', null, checks);
  
  if (!checks.docker) {
    logger.error('⚠️  AVISO: Docker não está disponível! Instâncias não poderão ser criadas.');
  }
  
  if (!checks.generateScript) {
    logger.error('⚠️  AVISO: Script generate.bash não encontrado! Verifique a estrutura de arquivos.');
  }
  
  app.listen(PORT, () => {
    logger.info(`🚀 Supabase Manager rodando em http://localhost:${PORT}`);
    logger.info(`📊 Dashboard: http://localhost:${PORT}`);
    logger.info(`🔧 Diagnóstico: http://localhost:${PORT}/api/diagnostics`);
    logger.info(`📋 VPS configurada: ${IP_VPS}`);
    logger.info(`📁 Docker path: ${DOCKER_PATH}`);
  });
}

startServer().catch((error) => {
  logger.error('Erro ao iniciar servidor', null, { error: error.message });
  process.exit(1);
});