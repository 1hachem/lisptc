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

{{- define "lisptc.previewNumber" -}}
{{- required "preview.number is required when preview.enabled" .Values.preview.number -}}
{{- end }}

{{- define "lisptc.imageTag" -}}
{{- $ctx := index . 0 -}}
{{- $tag := index . 1 -}}
{{- if $ctx.Values.preview.enabled -}}
{{- printf "pr-%s-%s" (include "lisptc.previewNumber" $ctx) (required "preview.sha is required when preview.enabled" $ctx.Values.preview.sha) -}}
{{- else -}}
{{- $tag -}}
{{- end -}}
{{- end }}

{{- define "lisptc.appHostname" -}}
{{- if .Values.preview.enabled -}}
{{- printf "lisptc-pr-%s" (include "lisptc.previewNumber" .) -}}
{{- else -}}
{{- .Values.app.hostname -}}
{{- end -}}
{{- end }}

{{- define "lisptc.convexCloudHostname" -}}
{{- if .Values.preview.enabled -}}
{{- printf "lisptc-pr-%s-convex" (include "lisptc.previewNumber" .) -}}
{{- else -}}
{{- .Values.convex.hostnames.cloud -}}
{{- end -}}
{{- end }}
