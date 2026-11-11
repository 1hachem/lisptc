load('ext://restart_process', 'docker_build_with_restart')

config.define_bool('prod')
config.define_string_list('to-run', args=True)
cfg = config.parse()
prod = cfg.get('prod', False)
if cfg.get('to-run', []):
    config.set_enabled_resources(cfg['to-run'])

if prod:
    trigger_mode(TRIGGER_MODE_MANUAL)

namespace = 'lisptc-dev'
registry = 'localhost:5000'

allow_k8s_contexts('default')
default_registry(registry)
watch_settings(ignore=[
    '.agents', '.claude', '.codex', '.direnv', '.fallow', '.github', '.husky', '.specify', '.topiary',
    '.playwright-mcp', '.llama-cache', '.r2', '.r2-cache', '.r2-mount',
    'argocd', 'argocd-previews', 'artifacts', 'deploy', 'docker', 'editors', 'examples', 'nix',
    'scripts', 'specs', 'taskfiles', 'worktrees',
    '*.md', 'LICENSE', 'Taskfile.yml', 'biome.json', 'knip.json', 'no-comments.json',
    'lint-staged.config.ts', '.commitlintrc.ts', '.fallowrc.json', '.mcp.json', '.infisical.json',
    '.env*', '.envrc', 'flake.nix', 'flake.lock', '.gitignore',
    'apps/desktop/release', 'apps/trace-viewer/.evals',
    '**/node_modules', '**/.turbo', '**/dist', '**/coverage', '**/.output', '**/.nitro',
    '**/.tanstack', '**/.vite', '**/.next', '**/*.tsbuildinfo', '**/*.log', '**/.env.local',
    'Tiltfile.tmp.*',
])

local('kubectl create namespace %s --dry-run=client -o yaml | kubectl apply -f -' % namespace, quiet=True)

other_apps = ['apps/cli', 'apps/dashi-code', 'apps/desktop', 'apps/lsp', 'apps/mcp', 'apps/mcp-toolkit', 'apps/trace-viewer']

packages = str(local('ls packages', quiet=True)).split()

manifests = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/app/package.json'] + [
    'packages/%s/package.json' % p for p in packages
]

read_once_at_startup = str(local("git ls-files 'packages/*.ptc'", quiet=True)).split() + [
    'packages/toolkit/mcp.toolkit.json',
    'packages/mcp/mcp.toolkit.local.json',
]

if prod:
    docker_build(
        'ghcr.io/1hachem/lisptc-app',
        context='.',
        dockerfile='apps/app/Dockerfile',
        target='prod',
        secret=['id=web-build-vars,env=WEB_BUILD_VARS'],
        ignore=other_apps,
    )
else:
    docker_build_with_restart(
        'ghcr.io/1hachem/lisptc-app',
        context='.',
        dockerfile='apps/app/Dockerfile',
        target='dev',
        ignore=other_apps,
        entrypoint=['pnpm', 'run', 'dev', '--host', '127.0.0.1'],
        trigger=read_once_at_startup,
        live_update=[
            fall_back_on(manifests),
            sync('apps/app', '/app/apps/app'),
            sync('packages', '/app/packages'),
        ],
    )

convex_imports_outside_convex = ['packages/%s' % p for p in packages if p != 'backend'] + ['packages/backend/src']

docker_build(
    'ghcr.io/1hachem/lisptc-convex-deploy',
    context='.',
    dockerfile='packages/backend/Dockerfile',
    target='prod' if prod else 'dev',
    ignore=['apps'],
    live_update=[] if prod else [
        fall_back_on(manifests),
        sync('packages', '/app/packages'),
        run('touch convex/schema.ts', trigger=convex_imports_outside_convex),
    ],
)

node = str(local('hostname', quiet=True)).strip()
rendered = helm(
    'charts/lisptc',
    name='lisptc',
    namespace=namespace,
    values=['charts/lisptc/values-dev.yaml'],
    set=['dev.node=' + node, 'dev.watch=%s' % ('false' if prod else 'true')],
)
objects = decode_yaml_stream(rendered)
for o in objects:
    o['metadata']['namespace'] = namespace
k8s_yaml(encode_yaml_stream(objects))

def named(kind):
    return [o['metadata']['name'] for o in objects if o['kind'] == kind]

k8s_kind('Cluster', api_version='postgresql.cnpg.io/v1', pod_readiness='wait')

k8s_resource(
    new_name='secrets',
    objects=['%s:infisicalsecret' % name for name in named('InfisicalSecret')],
    labels=['infra'],
)
synced = [
    ref['secretName']
    for o in objects if o['kind'] == 'InfisicalSecret'
    for ref in o['spec']['managedKubeSecretReferences']
]
local_resource(
    'secrets-synced',
    cmd='kubectl -n %s wait --for=create --timeout=5m %s' % (namespace, ' '.join(['secret/' + s for s in synced])),
    resource_deps=['secrets'],
    labels=['infra'],
)
k8s_resource(
    'db',
    new_name='postgres',
    objects=['%s:podmonitor' % name for name in named('PodMonitor')],
    resource_deps=['secrets-synced'],
    port_forwards=['5432:5432'],
    labels=['infra'],
)
k8s_resource(
    'convex-backend',
    resource_deps=['postgres'],
    port_forwards=['3210:3210', '3211:3211'],
    labels=['convex'],
)
k8s_resource(
    named('Job')[0] if prod else 'convex-deploy',
    new_name='convex-deploy',
    resource_deps=['convex-backend'],
    labels=['convex'],
)
k8s_resource(
    'app',
    resource_deps=['convex-deploy'],
    links=[link('http://localhost:3000', 'app')],
    labels=['app'],
)
