resource "azurerm_user_assigned_identity" "eso" {
  name                = "eso-identity"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "eso" {
  name                = "eso-federated"
  resource_group_name = azurerm_resource_group.rg.name
  issuer              = azurerm_kubernetes_cluster.aks.oidc_issuer_url
  subject             = "system:serviceaccount:external-secrets:external-secrets-sa"
  audience            = ["api://AzureADTokenExchange"]
  parent_id           = azurerm_user_assigned_identity.eso.id
}

resource "azurerm_role_assignment" "eso_kv_reader" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.eso.principal_id
}

resource "azurerm_role_assignment" "aks_network" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.aks.identity[0].principal_id
}
