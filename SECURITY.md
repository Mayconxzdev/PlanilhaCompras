# Segurança

## Escopo desta demonstração

Este repositório contém somente dados sintéticos e não aceita credenciais, bancos, logs ou informações operacionais no controle de versão. Consulte [docs/security.md](docs/security.md) para as decisões técnicas da demonstração.

## Uso local e em rede

O modo demonstrativo serve apenas para explorar o produto localmente. Para qualquer implantação em rede, defina `PROCUREFLOW_ADMIN_TOKEN`, mantenha o serviço em uma rede confiável e revise `docs/setup.md` antes de liberar escrita, backup ou restauração para outros computadores.

## Relato responsável

Não publique vulnerabilidades, tokens ou dados sensíveis em issues públicas. Use o canal privado de relato de segurança habilitado neste repositório e nunca anexe credenciais, bancos ou informações operacionais.

## Limites conhecidos

Esta demonstração não implementa identidade corporativa, autorização por perfil, auditoria imutável ou um banco transacional multiusuário. Esses são próximos passos arquiteturais documentados, não funcionalidades anunciadas como prontas.
