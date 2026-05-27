UPDATE allocation_plans SET mode = 'inverse_volatility' WHERE mode = 'risk_parity';
UPDATE allocation_plans SET mode = 'inverse_volatility' WHERE mode = 'target_vol';
UPDATE allocation_plans SET mode = 'max_diversification' WHERE mode = 'max_sharpe';
