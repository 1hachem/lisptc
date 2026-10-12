{{- define "lisptc.url" -}}
https://{{ . }}.$(TAILNET_DOMAIN)
{{- end }}

{{- define "lisptc.convexSiteUrl" -}}
{{- printf "http://convex-backend.%s.svc.cluster.local:3211" .Release.Namespace -}}
{{- end }}

{{- define "lisptc.previewConvexEnv" -}}
{{- if .Values.preview.enabled }}
- name: CONVEX_URL
  value: {{ printf "http://convex-backend.%s.svc.cluster.local:3210" .Release.Namespace | quote }}
- name: CONVEX_SITE_URL
  value: {{ include "lisptc.convexSiteUrl" . | quote }}
{{- end }}
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

{{- define "lisptc.builtForRelease" -}}
{{- $ctx := index . 0 -}}
{{- $tag := toString (index . 1) -}}
{{- if or (not $ctx.Values.preview.enabled) (hasPrefix (printf "pr-%v-" $ctx.Values.preview.number) $tag) -}}
true
{{- end -}}
{{- end }}
