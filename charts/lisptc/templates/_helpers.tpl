{{- define "lisptc.url" -}}
https://{{ . }}.$(TAILNET_DOMAIN)
{{- end }}

{{- define "lisptc.previewEnv" -}}
{{- $ctx := index . 0 -}}
{{- $vars := index . 1 -}}
{{- if $ctx.Values.preview.enabled }}
- name: TAILNET_DOMAIN
  valueFrom:
    secretKeyRef:
      name: {{ $ctx.Values.preview.tailnetSecret }}
      key: TAILNET_DOMAIN
{{- range $name, $host := $vars }}
- name: {{ $name }}
  value: {{ include "lisptc.url" $host | quote }}
{{- end }}
{{- end }}
{{- end }}
