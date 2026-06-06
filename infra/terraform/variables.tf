variable "location" {
  type    = string
  default = "westeurope"
}

variable "resource_group_name" {
  type    = string
  default = "creativeanchor-prod-rg"
}

variable "vnet_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}

variable "aks_name" {
  type    = string
  default = "creativeanchor-aks"
}

variable "acr_name" {
  type    = string
  default = "creativeanchoracr"
}

variable "key_vault_name" {
  type    = string
  default = "creativeanchor-kv"
}

variable "system_node_count" {
  type    = number
  default = 2
}

variable "system_node_vm_size" {
  type    = string
  default = "Standard_B2s_v2"
}

variable "kubernetes_version" {
  type    = string
  default = ""
  description = "Optional AKS version override. Leave empty to use the latest supported version in the region."
}

variable "ingress_public_ip_name" {
  type    = string
  default = "creativeanchor-ingress-ip"
}

variable "tags" {
  type = map(string)
  default = {
    environment = "prod"
    owner       = "platform"
    project     = "creativeanchor"
  }
}

variable "github_repo_url" {
  type        = string
  description = "Git repository URL for Argo CD applications"
}

variable "github_repo_branch" {
  type    = string
  default = "main"
}

variable "dns_zone" {
  type        = string
  description = "Public DNS zone for ingress hostnames (example: example.com)"
  default     = ""
}
