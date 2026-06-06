data "azurerm_kubernetes_service_versions" "current" {
  location        = azurerm_resource_group.rg.location
  include_preview = false
}

locals {
  aks_version = var.kubernetes_version != "" ? var.kubernetes_version : data.azurerm_kubernetes_service_versions.current.latest_version
}

resource "azurerm_kubernetes_cluster" "aks" {
  name                = var.aks_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  dns_prefix          = "${var.aks_name}-dns"
  kubernetes_version  = local.aks_version
  tags                = var.tags

  default_node_pool {
    name                = "system"
    node_count          = var.system_node_count
    vm_size             = var.system_node_vm_size
    vnet_subnet_id      = azurerm_subnet.aks.id
    type                = "VirtualMachineScaleSets"
    orchestrator_version = local.aks_version
    max_pods            = 20
    temporary_name_for_rotation = "systemtmp"
    upgrade_settings {
      max_surge = 1
    }
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin     = "azure"
    load_balancer_sku  = "standard"
    outbound_type      = "loadBalancer"
    dns_service_ip     = "10.20.2.10"
    service_cidr       = "10.20.2.0/24"
  }

  oidc_issuer_enabled       = true
  workload_identity_enabled = true
}
