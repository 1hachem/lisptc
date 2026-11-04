load('ext://restart_process', 'custom_build_with_restart')

config.define_bool('prod')
cfg = config.parse()
prod = cfg.get('prod', False)

namespace = 'lisptc-dev'
registry = 'localhost:5000'

allow_k8s_contexts('default')
default_registry(registry)
watch_settings(ignore=['worktrees'])

local('kubectl create namespace %s --dry-run=client -o yaml | kubectl apply -f -' % namespace, quiet=True)

build_ignore = ['**/node_modules', '**/.turbo', '**/dist', '**/.output', '**/.nitro', '**/.tanstack', '**/.vite']

app_build_command = 'docker build --progress=plain -f apps/app/Dockerfile --target %s %s -t $EXPECTED_REF .'
app_deps = [
    'apps/app/Dockerfile',
    'apps/app/package.json',
    'apps/app/vite.config.ts',
    'apps/app/src',
    'apps/app/server',
    'apps/app/public',
    'packages',
    'pnpm-lock.yaml',
]

if prod:
    custom_build(
        'ghcr.io/1hachem/lisptc-app',
        app_build_command % ('prod', '--secret id=web-build-vars,env=WEB_BUILD_VARS'),
        deps=app_deps,
        ignore=build_ignore,
    )
else:
    client_only_packages = ['bloub', 'components', 'ui', 'ui-catalog']
    server_packages = [
        'packages/' + p
        for p in str(local('ls packages', quiet=True)).split()
        if p not in client_only_packages
    ]
    custom_build_with_restart(
        'ghcr.io/1hachem/lisptc-app',
        app_build_command % ('dev', ''),
        deps=app_deps,
        ignore=build_ignore,
        entrypoint=['pnpm', 'run', 'dev', '--host', '127.0.0.1'],
        trigger=['apps/app/server'] + server_packages,
        live_update=[
            fall_back_on(['apps/app/vite.config.ts', 'apps/app/package.json', 'pnpm-lock.yaml']),
            sync('apps/app/src', '/app/apps/app/src'),
            sync('apps/app/server', '/app/apps/app/server'),
            sync('apps/app/public', '/app/apps/app/public'),
            sync('packages', '/app/packages'),
        ],
    )

custom_build(
    'ghcr.io/1hachem/lisptc-convex-deploy',
    'docker build --progress=plain -f packages/backend/Dockerfile --target prod -t $EXPECTED_REF .',
    deps=[
        'packages/backend/Dockerfile',
        'packages/backend/package.json',
        'packages/backend/convex',
        'packages/interpreter',
        'packages/shared',
        'packages/ui',
        'pnpm-lock.yaml',
    ],
    ignore=build_ignore,
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
