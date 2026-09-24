# Império GameCloud v4 — versão local funcional

## Como abrir no Windows
1. Instale o Node.js LTS em https://nodejs.org/ (caso não esteja instalado).
2. Copie `config/admin.env.example` para `config/admin.env` e substitua ADMIN_USER pelo seu e-mail e ADMIN_PASSWORD por uma senha forte exclusiva. Não publique esse arquivo.
3. Dê dois cliques em `iniciar_windows.bat`. Abra http://localhost:8080 no navegador.
4. Cadastre uma conta de jogador ou entre com o e-mail/senha definidos para o administrador.

## O que funciona
Cadastro e login com senhas protegidas por scrypt, sessão persistente opcional por 30 dias no navegador, sair da conta, lista de jogadores e total online, painel administrativo e adição de minutos. Os dados dos jogadores ficam salvos em `data/users.json` mesmo após reiniciar. Não salve a senha em texto no site: a opção de manter conectado guarda um token de sessão, e o navegador pode oferecer seu próprio gerenciador de senhas.

## O que requer serviços externos
O envio de recuperação de senha por e-mail não está configurado: em ambiente local o link temporário é registrado no terminal do servidor, sem o token ser exibido ao solicitante. Streaming real de FiveM, hospedagem pública, pagamentos, atualizações automáticas e backups remotos também exigem infraestrutura adicional. O painel não finge que esses serviços estão ativos. Para colocar o sistema na internet, configure HTTPS, banco de dados, serviço de e-mail e proteções de produção antes de aceitar usuários reais. Nunca compartilhe `config/admin.env` nem `data/users.json`.
