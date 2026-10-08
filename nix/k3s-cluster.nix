{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.lisptc.k3s;
  isServer = cfg.role == "server";
  isFirstServer = isServer && cfg.serverAddr == "";
in {
  options.lisptc.k3s = {
    role = lib.mkOption {
      type = lib.types.enum ["server" "agent"];
      default = "server";
      description = "A server runs the control plane and takes workloads too; an agent only takes workloads.";
    };
    serverAddr = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "https://lisptc-k3s.tail1234.ts.net:6443";
      description = "The first server's API, over the tailnet. Empty on the first server, which initialises the cluster.";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/etc/k3s/token";
      description = "The shared join token. The first server writes one to /var/lib/rancher/k3s/server/token when unset; every other node needs a copy.";
    };
    kubeconfigGroup = lib.mkOption {
      type = lib.types.str;
      default = "wheel";
      description = "The group allowed to read the admin kubeconfig on a server. Nobody outside it can.";
    };
  };

  config = {
    services.k3s = {
      enable = true;
      inherit (cfg) role serverAddr tokenFile;
      clusterInit = isFirstServer;
      extraFlags = toString ([
          "--flannel-iface=tailscale0"
        ]
        ++ lib.optionals isServer [
          "--disable=traefik"
          "--write-kubeconfig-mode=0640"
          "--write-kubeconfig-group=${cfg.kubeconfigGroup}"
        ]);
    };

    services.tailscale.enable = true;

    systemd.services.k3s = {
      after = ["tailscaled.service"];
      wants = ["tailscaled.service"];
    };

    networking.firewall.trustedInterfaces = ["tailscale0" "cni0" "flannel.1"];

    environment.variables = lib.mkIf isServer {
      KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
    };

    environment.systemPackages = lib.mkIf isServer (with pkgs; [
      kubectl
      (wrapHelm kubernetes-helm {plugins = [kubernetes-helmPlugins.helm-diff];})
      helmfile
      k9s
      go-task
      git
    ]);
  };
}
