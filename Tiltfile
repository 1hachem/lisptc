config.define_bool('prod')
cfg = config.parse()
prod = cfg.get('prod', False)

namespace = 'lisptc-dev'
registry = 'localhost:5000'

allow_k8s_contexts('default')
default_registry(registry)
watch_settings(ignore=['worktrees', '.claude/', '**/node_modules/**', '**/.turbo/**', '**/tsconfig.tsbuildinfo', 'Tiltfile.tmp.*'])

local('kubectl create namespace %s --dry-run=client -o yaml | kubectl apply -f -' % namespace, quiet=True)

other_apps = ['apps/cli', 'apps/dashi-code', 'apps/desktop', 'apps/lsp', 'apps/mcp', 'apps/mcp-toolkit', 'apps/trace-viewer']

docker_build(
    'ghcr.io/1hachem/lisptc-app',
    context='.',
    dockerfile='apps/app/Dockerfile',
    target='prod' if prod else 'dev',
    secret=['id=web-build-vars,env=WEB_BUILD_VARS'] if prod else [],
    ignore=other_apps,
    live_update=[] if prod else [
        sync('apps/app', '/app/apps/app'),
        sync('packages', '/app/packages'),
    ],
)

docker_build(
    'ghcr.io/1hachem/lisptc-convex-deploy',
    context='.',
    dockerfile='packages/backend/Dockerfile',
    target='prod',
    ignore=['apps'],
)

node = str(local('hostname', quiet=True)).strip()
rendered = helm(
    'charts/lisptc',
    name='lisptc',
    namespace=namespace,
    values=['charts/lisptc/values-dev.yaml'],
    set=['dev.node=' + node],
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
k8s_resource(
    'db',
    new_name='postgres',
    objects=['%s:podmonitor' % name for name in named('PodMonitor')],
    resource_deps=['secrets'],
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
    named('Job')[0],
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
