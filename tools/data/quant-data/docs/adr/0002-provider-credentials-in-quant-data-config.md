# Provider Credentials Live In Quant Data Config

Status: accepted

The data-maintenance CLI owns provider configuration, including provider credentials, under the local quant-data configuration directory. Credentials are user-editable plaintext files with strict permission checks; missing or insecure configuration is reported through maintenance error codes and messages such as `CONFIG_REQUIRED` or `CONFIG_INSECURE`. This favors transparent local setup and CLI independence from host application credential stores over OS keychain protection.