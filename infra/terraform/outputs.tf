output "aks_name" {
  value = azurerm_kubernetes_cluster.aks.name
}

output "aks_rg" {
  value = azurerm_resource_group.rg.name
}

output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "key_vault_name" {
  value = azurerm_key_vault.kv.name
}

output "ingress_public_ip" {
  value = azurerm_public_ip.ingress.ip_address
}

output "argocd_namespace" {
  value = kubernetes_namespace.argocd.metadata[0].name
}
