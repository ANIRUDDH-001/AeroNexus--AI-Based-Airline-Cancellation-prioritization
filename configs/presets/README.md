# Presets

A preset is a YAML file with any of the top-level keys `parameters`, `objective_terms`, `constraints`, `search`.
Keys present in the preset replace the corresponding registry wholesale. Load with
`load_config("configs", preset="<name>")`. Save the current UI configuration as a preset from the Parameters page.
