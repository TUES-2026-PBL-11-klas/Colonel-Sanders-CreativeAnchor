resource "helm_release" "ingress_nginx" {
  name       = "ingress-nginx"
  namespace  = kubernetes_namespace.ingress.metadata[0].name
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  version    = "4.10.0"

  values = [
    templatefile("${path.module}/values/ingress-nginx.yaml", {
      ingress_public_ip    = azurerm_public_ip.ingress.ip_address
      ingress_public_ip_rg = azurerm_resource_group.rg.name
    })
  ]

  set {
    name  = "controller.resources.requests.cpu"
    value = "100m"
  }
  set {
    name  = "controller.resources.requests.memory"
    value = "128Mi"
  }
  set {
    name  = "global.imagePullSecrets[0].name"
    value = "acr-auth"
  }
  timeout    = 1800
  wait       = true
  depends_on = [kubernetes_namespace.ingress, azurerm_kubernetes_cluster.aks, null_resource.kubeconfig]
}

resource "helm_release" "argocd" {
  name       = "argocd"
  namespace  = kubernetes_namespace.argocd.metadata[0].name
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "6.7.5"

  values = [
    templatefile("${path.module}/values/argo-cd.yaml", {
      dns_zone = var.dns_zone
    })
  ]

  set {
    name  = "global.imagePullSecrets[0].name"
    value = "acr-auth"
  }

  set {
    name  = "controller.resources.requests.cpu"
    value = "50m"
  }
  set {
    name  = "controller.resources.requests.memory"
    value = "64Mi"
  }
  timeout    = 1800
  wait       = true
  depends_on = [kubernetes_namespace.argocd, azurerm_kubernetes_cluster.aks, null_resource.kubeconfig, helm_release.ingress_nginx]
}

resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  namespace  = kubernetes_namespace.external_secrets.metadata[0].name
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = "0.9.19"

  values = [
    templatefile("${path.module}/values/external-secrets.yaml", {
      eso_client_id = azurerm_user_assigned_identity.eso.client_id
    })
  ]

  depends_on = [kubernetes_namespace.external_secrets]
}

resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "57.0.2"

  values = [file("${path.module}/values/kube-prometheus-stack.yaml")]

  set {
    name  = "kubeStateMetrics.resources.requests.cpu"
    value = "100m"
  }
  set {
    name  = "kubeStateMetrics.resources.requests.memory"
    value = "128Mi"
  }
  set {
    name  = "global.imagePullSecrets[0].name"
    value = "acr-auth"
  }
  timeout    = 1800
  depends_on = [kubernetes_namespace.monitoring, helm_release.loki]
  wait       = true

}

resource "helm_release" "loki" {
  name       = "loki"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki"
  version    = "6.10.0"

  values = [file("${path.module}/values/loki.yaml")]

  # Explicitly zero out scalable targets so the chart validator
  # does not require an object-storage backend
  set {
    name  = "backend.replicas"
    value = "0"
  }
  set {
    name  = "read.replicas"
    value = "0"
  }
  set {
    name  = "write.replicas"
    value = "0"
  }

  # Disable optional heavyweight sub-charts
  set {
    name  = "chunksCache.enabled"
    value = "false"
  }
  set {
    name  = "resultsCache.enabled"
    value = "false"
  }
  set {
    name  = "gateway.enabled"
    value = "false"
  }
  set {
    name  = "lokiCanary.enabled"
    value = "true"
  }

  # Single binary: 1 replica
  set {
    name  = "singleBinary.replicas"
    value = "1"
  }

  timeout    = 300
  depends_on = [kubernetes_namespace.monitoring]
}

resource "helm_release" "promtail" {
  name       = "promtail"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://grafana.github.io/helm-charts"
  chart      = "promtail"
  version    = "6.15.5"

  values = [file("${path.module}/values/promtail.yaml")]

  depends_on = [kubernetes_namespace.monitoring]
}
