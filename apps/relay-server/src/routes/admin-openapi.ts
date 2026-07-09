/* eslint-disable max-lines -- OpenAPI schema is intentionally colocated with the public admin route. */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../http.js'
import type { RelayServerArgs } from '../types.js'
import { VERSION } from '../version.js'
import { publicRequestBaseUrl } from './request-origin.js'

type JsonObject = Record<string, unknown>

const bearerSecurity = [{ bearerAuth: [] }]

const nullableString = {
  oneOf: [{ type: 'string' }, { type: 'null' }]
}

const jsonResponse = (description: string, schema: JsonObject) => ({
  content: {
    'application/json': {
      schema
    }
  },
  description
})

const errorResponse = (description: string) =>
  jsonResponse(description, {
    $ref: '#/components/schemas/ErrorResponse'
  })

const methodNotAllowed = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}

const adminAuthResponses = {
  401: errorResponse('Authentication is required.'),
  403: errorResponse('The caller does not have the required Relay permission.')
}

const validationResponses = {
  400: errorResponse('The request body or parameters are invalid.'),
  409: errorResponse('The request conflicts with an existing Relay resource.')
}

const pathIdParameter = (name: string, description: string) => ({
  in: 'path',
  name,
  required: true,
  schema: {
    type: 'string'
  },
  description
})

const bearerOperation = (operation: JsonObject) => ({
  security: bearerSecurity,
  ...operation
})

const requestBody = (schema: JsonObject, description?: string) => ({
  content: {
    'application/json': {
      schema
    }
  },
  ...(description == null ? {} : { description }),
  required: true
})

const buildAllComponents = (bearerFormat: string) => ({
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat
    }
  },
  schemas: {
    ErrorResponse: {
      type: 'object',
      additionalProperties: true,
      required: ['error'],
      properties: {
        error: {
          type: 'string'
        }
      }
    },
    RelayRole: {
      type: 'string',
      enum: ['owner', 'admin', 'member', 'viewer']
    },
    RelayAdminUser: {
      type: 'object',
      required: [
        'id',
        'email',
        'name',
        'disabled',
        'deviceCount',
        'maxDevices',
        'passwordEnabled',
        'role',
        'createdAt'
      ],
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
        loginId: nullableString,
        name: { type: 'string' },
        avatarUrl: nullableString,
        disabled: { type: 'boolean' },
        disabledAt: nullableString,
        deviceCount: { type: 'integer', minimum: 0 },
        maxDevices: {
          oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }]
        },
        passwordEnabled: { type: 'boolean' },
        provider: nullableString,
        role: { $ref: '#/components/schemas/RelayRole' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayAdminUserCreate: {
      type: 'object',
      required: ['email'],
      properties: {
        id: { type: 'string', description: 'Optional operator supplied user id.' },
        email: { type: 'string', format: 'email' },
        loginId: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string', writeOnly: true },
        role: { $ref: '#/components/schemas/RelayRole' },
        maxDevices: { type: 'integer', minimum: 0 },
        disabled: { type: 'boolean' }
      }
    },
    RelayAdminUserPatch: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Required when the user id is not present in the path.' },
        email: { type: 'string', format: 'email' },
        loginId: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string', writeOnly: true },
        role: { $ref: '#/components/schemas/RelayRole' },
        maxDevices: {
          oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }]
        },
        disabled: { type: 'boolean' }
      }
    },
    RelayAdminInvite: {
      type: 'object',
      required: ['code', 'role', 'maxUses', 'used', 'createdAt'],
      properties: {
        code: { type: 'string' },
        role: { $ref: '#/components/schemas/RelayRole' },
        userId: nullableString,
        maxUses: { type: 'integer', minimum: 1 },
        used: { type: 'integer', minimum: 0 },
        expiresAt: nullableString,
        revokedAt: nullableString,
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayAdminInviteCreate: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Optional invite code. Omit to let Relay generate one.'
        },
        role: { $ref: '#/components/schemas/RelayRole' },
        userId: { type: 'string' },
        maxUses: { type: 'integer', minimum: 1 },
        expiresAt: { type: 'string', format: 'date-time' }
      }
    },
    RelayAdminInvitePatch: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Required when the invite code is not present in the path.' },
        role: { $ref: '#/components/schemas/RelayRole' },
        maxUses: { type: 'integer', minimum: 1 },
        revoked: { type: 'boolean' }
      }
    },
    RelayAdminSsoProvider: {
      type: 'object',
      required: [
        'id',
        'name',
        'type',
        'authorizationUrl',
        'tokenUrl',
        'userInfoUrl',
        'scope',
        'enabled',
        'clientId',
        'clientSecret',
        'createdAt'
      ],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['oauth2', 'oidc'] },
        authorizationUrl: { type: 'string', format: 'uri' },
        tokenUrl: { type: 'string', format: 'uri' },
        userInfoUrl: { type: 'string', format: 'uri' },
        scope: { type: 'string' },
        enabled: { type: 'boolean' },
        clientId: { type: 'string' },
        clientSecret: {
          type: 'string',
          description: 'Always redacted in list and detail responses.'
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayAdminSsoProviderInput: {
      type: 'object',
      required: [
        'id',
        'name',
        'type',
        'authorizationUrl',
        'tokenUrl',
        'userInfoUrl',
        'clientId',
        'clientSecret'
      ],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['oauth2', 'oidc'] },
        authorizationUrl: { type: 'string', format: 'uri' },
        tokenUrl: { type: 'string', format: 'uri' },
        userInfoUrl: { type: 'string', format: 'uri' },
        scope: { type: 'string' },
        enabled: { type: 'boolean' },
        clientId: { type: 'string' },
        clientSecret: { type: 'string', writeOnly: true }
      }
    },
    RelayAdminSsoProviderPatch: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Required when the provider id is not present in the path.' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['oauth2', 'oidc'] },
        authorizationUrl: { type: 'string', format: 'uri' },
        tokenUrl: { type: 'string', format: 'uri' },
        userInfoUrl: { type: 'string', format: 'uri' },
        scope: { type: 'string' },
        enabled: { type: 'boolean' },
        clientId: { type: 'string' },
        clientSecret: {
          type: 'string',
          writeOnly: true,
          description: 'Omit to keep the stored secret.'
        }
      }
    },
    RelayTokenOperationKind: {
      type: 'string',
      enum: ['admin', 'device', 'session']
    },
    RelayTokenOperationInput: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { $ref: '#/components/schemas/RelayTokenOperationKind' },
        token: { type: 'string', writeOnly: true },
        sessionToken: { type: 'string', writeOnly: true },
        deviceId: { type: 'string' },
        userId: { type: 'string' }
      }
    },
    RelayTokenOperationResult: {
      type: 'object',
      additionalProperties: true,
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        kind: { $ref: '#/components/schemas/RelayTokenOperationKind' },
        operation: { type: 'string', enum: ['rotate', 'revoke'] },
        rotated: { type: 'boolean' },
        revoked: { type: 'boolean' },
        deviceId: { type: 'string' },
        userId: { type: 'string' },
        revokedSessions: { type: 'integer', minimum: 0 },
        deviceToken: {
          type: 'string',
          writeOnly: true,
          description: 'Returned only after a successful device token rotation.'
        },
        sessionToken: {
          type: 'string',
          writeOnly: true,
          description: 'Returned only after a successful session token rotation.'
        },
        error: { type: 'string' }
      }
    },
    RelayProfileAccessToken: {
      type: 'object',
      required: [
        'id',
        'name',
        'permissionGroupIds',
        'permissionGroupMode',
        'scope',
        'teamId',
        'tokenPreview',
        'createdAt',
        'lastUsedAt',
        'revokedAt'
      ],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        permissionGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Platform or team access group ids granted to this token when permissionGroupMode is custom.'
        },
        permissionGroupMode: {
          type: 'string',
          enum: ['all', 'custom'],
          description:
            'all follows the current account platform groups or the bound team member groups; custom restricts the token to listed groups.'
        },
        scope: {
          type: 'string',
          enum: ['user', 'team', 'platform'],
          description:
            'Token scope. user can call current-account APIs, team is restricted to one team, platform can call platform APIs granted by platform groups.'
        },
        teamId: {
          ...nullableString,
          description: 'Bound team id for team-scoped tokens. Null for user and platform tokens.'
        },
        tokenPreview: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        lastUsedAt: nullableString,
        revokedAt: nullableString
      }
    },
    RelayProfileSecuritySummary: {
      type: 'object',
      required: ['accessTokens', 'password', 'passkeys', 'twoFactor', 'accountDeletion'],
      properties: {
        accessTokens: {
          type: 'array',
          items: { $ref: '#/components/schemas/RelayProfileAccessToken' }
        },
        password: {
          type: 'object',
          required: ['enabled'],
          properties: {
            enabled: { type: 'boolean' }
          }
        },
        passkeys: {
          type: 'object',
          required: ['enabled', 'count', 'lastUsedAt'],
          properties: {
            enabled: { type: 'boolean' },
            count: { type: 'integer', minimum: 0 },
            lastUsedAt: nullableString
          }
        },
        twoFactor: {
          type: 'object',
          required: ['available', 'enabled'],
          properties: {
            available: { type: 'boolean' },
            enabled: { type: 'boolean' }
          }
        },
        accountDeletion: {
          type: 'object',
          required: ['available'],
          properties: {
            available: { type: 'boolean' }
          }
        }
      }
    },
    RelayProfileAccessTokenCreate: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        permissionGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Platform group ids for platform tokens or team member group ids for team tokens.'
        },
        permissionGroupMode: {
          type: 'string',
          enum: ['all', 'custom']
        },
        scope: {
          type: 'string',
          enum: ['user', 'team', 'platform'],
          description: 'Defaults to platform for backward compatibility.'
        },
        teamId: {
          type: 'string',
          description: 'Required when scope is team.'
        }
      }
    },
    RelayProfileAccessTokenUpdate: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        permissionGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Platform group ids for platform tokens or team member group ids for team tokens.'
        },
        permissionGroupMode: {
          type: 'string',
          enum: ['all', 'custom']
        },
        scope: {
          type: 'string',
          enum: ['user', 'team', 'platform']
        },
        teamId: {
          type: 'string',
          description: 'Required when scope is team.'
        }
      }
    },
    RelayProfileAccessTokenCreateResponse: {
      type: 'object',
      required: ['accessToken', 'token'],
      properties: {
        accessToken: {
          type: 'string',
          writeOnly: true,
          description: 'Full API access token. Returned only once.'
        },
        token: { $ref: '#/components/schemas/RelayProfileAccessToken' }
      }
    },
    RelayProfilePasswordChange: {
      type: 'object',
      required: ['password'],
      properties: {
        currentPassword: {
          type: 'string',
          writeOnly: true,
          description: 'Required when the account already has a password.'
        },
        password: {
          type: 'string',
          minLength: 8,
          writeOnly: true
        }
      }
    },
    RelayProfilePasskeyOptions: {
      type: 'object',
      required: ['options'],
      properties: {
        options: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    RelayProfilePasskeyVerify: {
      type: 'object',
      required: ['response'],
      properties: {
        credentialName: { type: 'string' },
        response: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    RelayAuthUser: {
      type: 'object',
      required: ['id', 'email', 'name', 'role'],
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
        loginId: nullableString,
        name: { type: 'string' },
        avatarUrl: nullableString,
        provider: nullableString,
        role: { $ref: '#/components/schemas/RelayRole' }
      }
    },
    RelayMetricsSnapshot: {
      type: 'object',
      additionalProperties: true,
      required: ['service', 'generatedAt', 'startedAt', 'devices', 'forwarding', 'traces'],
      properties: {
        service: { type: 'string', const: 'relay-server' },
        generatedAt: { type: 'string', format: 'date-time' },
        startedAt: { type: 'string', format: 'date-time' },
        devices: { type: 'object', additionalProperties: true },
        forwarding: { type: 'object', additionalProperties: true },
        traces: { type: 'object', additionalProperties: true }
      }
    },
    RelayAccessGroup: {
      type: 'object',
      required: [
        'id',
        'scope',
        'name',
        'localizedNames',
        'localizedDescriptions',
        'builtIn',
        'parentGroupId',
        'disabled',
        'disabledAt',
        'capabilities',
        'quotas',
        'memberCount',
        'createdAt',
        'updatedAt'
      ],
      properties: {
        id: { type: 'string' },
        scope: { type: 'string', enum: ['platform', 'team'] },
        name: { type: 'string' },
        localizedNames: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Locale-tagged display names keyed by BCP 47 locale. Built-in groups include every supported locale; the plain name remains the default fallback.'
        },
        description: nullableString,
        localizedDescriptions: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Locale-tagged descriptions keyed by BCP 47 locale. Built-in groups include every supported locale; the plain description remains the default fallback.'
        },
        builtIn: { type: 'boolean' },
        parentGroupId: nullableString,
        disabled: { type: 'boolean' },
        disabledAt: nullableString,
        capabilities: {
          type: 'object',
          required: ['allow', 'deny'],
          properties: {
            allow: { type: 'array', items: { type: 'string' } },
            deny: { type: 'array', items: { type: 'string' } }
          }
        },
        quotas: {
          type: 'object',
          additionalProperties: {
            oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }]
          }
        },
        memberCount: { type: 'integer', minimum: 0 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayAccessGroupInput: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Optional operator supplied group id.' },
        scope: { type: 'string', enum: ['platform', 'team'] },
        name: { type: 'string' },
        localizedNames: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Locale-tagged display names keyed by BCP 47 locale. Use only locales supported by the Relay Admin deployment.'
        },
        description: { type: 'string' },
        localizedDescriptions: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Locale-tagged descriptions keyed by BCP 47 locale. Use only locales supported by the Relay Admin deployment.'
        },
        parentGroupId: { type: 'string' },
        capabilities: {
          type: 'object',
          properties: {
            allow: { type: 'array', items: { type: 'string' } },
            deny: { type: 'array', items: { type: 'string' } }
          }
        },
        quotas: {
          type: 'object',
          additionalProperties: {
            oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }]
          }
        },
        disabled: { type: 'boolean' }
      }
    },
    RelayTeamPolicy: {
      type: 'object',
      additionalProperties: true,
      description: 'Tenant team and managed configuration policy.'
    },
    RelayTeamPolicyPatch: {
      type: 'object',
      additionalProperties: true,
      description: 'Partial tenant team policy update.'
    },
    RelayTeam: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'slug', 'name', 'createdAt'],
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        description: nullableString,
        avatarUrl: nullableString,
        proxyModeEnabled: { type: 'boolean' },
        archivedAt: nullableString,
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayTeamInput: {
      type: 'object',
      additionalProperties: true,
      properties: {
        avatarUrl: { type: 'string' },
        description: { type: 'string' },
        name: { type: 'string' },
        proxyModeEnabled: { type: 'boolean' },
        slug: { type: 'string' }
      }
    },
    RelayTeamMember: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'teamId', 'userId', 'role', 'createdAt'],
      properties: {
        id: { type: 'string' },
        teamId: { type: 'string' },
        userId: { type: 'string' },
        role: { type: 'string' },
        configEnabled: { type: 'boolean' },
        defaultForPublishing: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayTeamMemberInput: {
      type: 'object',
      additionalProperties: true,
      properties: {
        configEnabled: { type: 'boolean' },
        defaultForPublishing: { type: 'boolean' },
        email: { type: 'string', format: 'email' },
        role: { type: 'string' },
        userId: { type: 'string' }
      }
    },
    RelayTeamInvitation: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'teamId', 'role', 'status', 'createdAt'],
      properties: {
        id: { type: 'string' },
        teamId: { type: 'string' },
        email: nullableString,
        userId: nullableString,
        role: { type: 'string' },
        status: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        respondedAt: nullableString,
        updatedAt: nullableString
      }
    },
    RelayAuditEvent: {
      type: 'object',
      additionalProperties: true
    },
    RelayOpenApiAuditEvent: {
      type: 'object',
      required: ['id', 'tokenId', 'tokenPreview', 'userId', 'method', 'path', 'status', 'createdAt'],
      properties: {
        id: { type: 'string' },
        tokenId: { type: 'string' },
        tokenPreview: { type: 'string' },
        userId: { type: 'string' },
        method: { type: 'string' },
        path: { type: 'string' },
        status: { type: 'integer' },
        ip: nullableString,
        userAgent: nullableString,
        permission: nullableString,
        error: nullableString,
        createdAt: { type: 'string', format: 'date-time' }
      }
    },
    RelayMessage: {
      type: 'object',
      additionalProperties: true
    },
    RelayMessageInput: {
      type: 'object',
      additionalProperties: true,
      properties: {
        body: { type: 'string' },
        emails: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string' },
        scope: { type: 'string' },
        teamId: { type: 'string' },
        title: { type: 'string' },
        userIds: { type: 'array', items: { type: 'string' } }
      }
    },
    RelayConfigProfile: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'teamId', 'name', 'status', 'createdAt'],
      properties: {
        id: { type: 'string' },
        teamId: { type: 'string' },
        name: { type: 'string' },
        description: nullableString,
        status: { type: 'string' },
        activeVersionId: nullableString,
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: nullableString
      }
    },
    RelayConfigProfileInput: {
      type: 'object',
      additionalProperties: true
    },
    RelayConfigProfileVersionInput: {
      type: 'object',
      additionalProperties: true
    },
    RelayConfigAssignment: {
      type: 'object',
      additionalProperties: true
    },
    RelayConfigAssignmentInput: {
      type: 'object',
      additionalProperties: true
    },
    RelayConfigSecret: {
      type: 'object',
      additionalProperties: true,
      description: 'Redacted managed configuration secret metadata.'
    },
    RelayConfigSecretInput: {
      type: 'object',
      additionalProperties: true,
      required: ['name', 'value'],
      properties: {
        name: { type: 'string' },
        value: { type: 'string', writeOnly: true }
      }
    },
    RelayConfigSecretRotate: {
      type: 'object',
      additionalProperties: true,
      required: ['value'],
      properties: {
        value: { type: 'string', writeOnly: true }
      }
    },
    RelayConfigSnapshot: {
      type: 'object',
      additionalProperties: true
    },
    RelayEncryptedPayload: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'ciphertext', 'iv', 'tag', 'version'],
      properties: {
        algorithm: { type: 'string', enum: ['aes-256-gcm'] },
        ciphertext: { type: 'string', description: 'Base64 encoded ciphertext.' },
        iv: { type: 'string', description: 'Base64 encoded initialization vector.' },
        tag: { type: 'string', description: 'Base64 encoded authentication tag.' },
        version: { type: 'integer', enum: [1] }
      }
    },
    RelayPersonalDocumentCounts: {
      type: 'object',
      additionalProperties: false,
      required: ['agents', 'ooAgents', 'ooRules'],
      properties: {
        agents: { type: 'integer', minimum: 0, description: 'Number of synced AGENTS.md files.' },
        ooAgents: { type: 'integer', minimum: 0, description: 'Number of synced .oo/AGENTS.md files.' },
        ooRules: { type: 'integer', minimum: 0, description: 'Number of synced .oo/rules markdown files.' }
      }
    },
    RelayPersonalDocumentSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['countsByKind', 'documentCount', 'encryptedPayload', 'hash', 'totalSizeBytes', 'updatedAt', 'version'],
      properties: {
        countsByKind: { $ref: '#/components/schemas/RelayPersonalDocumentCounts' },
        documentCount: { type: 'integer', minimum: 0 },
        encryptedPayload: { $ref: '#/components/schemas/RelayEncryptedPayload' },
        hash: { type: 'string', description: 'Stable encrypted document snapshot hash.' },
        totalSizeBytes: { type: 'integer', minimum: 0 },
        updatedAt: { type: 'string', format: 'date-time' },
        version: { type: 'integer', enum: [1] }
      }
    },
    RelayTeamDocumentSnapshot: {
      allOf: [
        { $ref: '#/components/schemas/RelayPersonalDocumentSnapshot' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['teamId'],
          properties: {
            teamId: { type: 'string' },
            updatedByUserId: nullableString
          }
        }
      ],
      description:
        'Encrypted team instruction documents; Relay stores only ciphertext, counts, total size, and actor metadata.'
    },
    RelayTeamDocumentSnapshotResponse: {
      type: 'object',
      required: ['teamDocumentSnapshot'],
      properties: {
        teamDocumentSnapshot: {
          oneOf: [
            { $ref: '#/components/schemas/RelayTeamDocumentSnapshot' },
            { type: 'null' }
          ]
        }
      }
    },
    RelayTeamDocumentUpdate: {
      type: 'object',
      additionalProperties: false,
      required: ['documents'],
      properties: {
        baseHash: {
          type: 'string',
          description:
            'Hash read from the previous team document snapshot. Stale writes return 409 unless force is true.'
        },
        documents: {
          $ref: '#/components/schemas/RelayPersonalDocumentSnapshot',
          description: 'Encrypted team instruction documents plus server-visible counts and total size.'
        },
        force: {
          type: 'boolean',
          description: 'Overwrite the current server snapshot even when baseHash is stale.'
        }
      }
    },
    RelayPersonalConfigSnapshot: {
      type: 'object',
      required: ['allowedFields', 'hash', 'updatedAt', 'userId', 'version'],
      properties: {
        allowedFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Top-level configuration fields included in this personal snapshot.'
        },
        configPatch: {
          type: 'object',
          additionalProperties: true,
          description: 'Safe global configuration patch for the current Relay user.'
        },
        documents: {
          $ref: '#/components/schemas/RelayPersonalDocumentSnapshot',
          description: 'Encrypted user-home instruction documents; the server stores only ciphertext and statistics.'
        },
        hash: { type: 'string', description: 'Stable snapshot hash used for optimistic concurrency.' },
        sourceDeviceId: nullableString,
        updatedAt: { type: 'string', format: 'date-time' },
        userId: { type: 'string' },
        version: { type: 'string' }
      }
    },
    RelayPersonalConfigSnapshotResponse: {
      type: 'object',
      required: ['personalConfigSnapshot'],
      properties: {
        personalConfigSnapshot: {
          oneOf: [
            { $ref: '#/components/schemas/RelayPersonalConfigSnapshot' },
            { type: 'null' }
          ]
        }
      }
    },
    RelayPersonalConfigUpdate: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allowedFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Safe top-level fields to accept. Unknown or unsafe fields are filtered server-side.'
        },
        baseHash: {
          type: 'string',
          description: 'Hash read from the previous snapshot. A stale hash returns 409 unless force is true.'
        },
        configPatch: {
          type: 'object',
          additionalProperties: true
        },
        documents: {
          $ref: '#/components/schemas/RelayPersonalDocumentSnapshot',
          description: 'Encrypted user-home instruction documents plus server-visible counts and total size.'
        },
        force: {
          type: 'boolean',
          description: 'Overwrite the current server snapshot even when baseHash is stale.'
        }
      }
    }
  }
})

const buildComponents = (bearerFormat: string, schemaNames: ReadonlySet<string>) => {
  const components = buildAllComponents(bearerFormat)
  return {
    ...components,
    schemas: Object.fromEntries(
      Object.entries(components.schemas).filter(([name]) => schemaNames.has(name))
    )
  }
}

const buildOpenApiPaths = (path: string, summary: string, description: string) => ({
  [path]: {
    get: {
      operationId: path.includes('/profile/') ? 'getRelayProfileOpenApi' : 'getRelayAdminOpenApi',
      summary,
      tags: ['OpenAPI'],
      responses: {
        200: jsonResponse(description, {
          type: 'object',
          additionalProperties: true
        })
      }
    }
  }
})

const buildCommonPaths = () => ({
  '/health': {
    get: {
      operationId: 'getRelayHealth',
      summary: 'Read Relay server health and version',
      tags: ['System'],
      responses: {
        200: jsonResponse('Relay server health.', {
          type: 'object',
          required: ['ok', 'version'],
          properties: {
            ok: { type: 'boolean' },
            version: { type: 'string' }
          }
        })
      }
    }
  },
  '/api/relay/info': {
    get: {
      operationId: 'getRelayInfo',
      summary: 'Read Relay server public capability information',
      tags: ['System'],
      responses: {
        200: jsonResponse('Public Relay feature flags and enabled auth providers.', {
          type: 'object',
          additionalProperties: true
        })
      }
    }
  },
  '/api/auth/providers': {
    get: {
      operationId: 'listRelayAuthProviders',
      summary: 'List enabled login providers',
      tags: ['Auth'],
      responses: {
        200: jsonResponse('Enabled OAuth/OIDC login providers.', {
          type: 'object',
          required: ['providers'],
          properties: {
            providers: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'displayName'],
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' }
                }
              }
            }
          }
        })
      }
    }
  },
  '/api/auth/me': {
    get: bearerOperation({
      operationId: 'getRelayAuthMe',
      summary: 'Read the current Relay login session',
      tags: ['Auth'],
      responses: {
        200: jsonResponse('Current session and user.', {
          type: 'object',
          required: ['session', 'user'],
          properties: {
            session: {
              type: 'object',
              required: ['expiresAt', 'lastSeenAt'],
              properties: {
                expiresAt: { type: 'string', format: 'date-time' },
                lastSeenAt: { type: 'string', format: 'date-time' }
              }
            },
            user: { $ref: '#/components/schemas/RelayAuthUser' }
          }
        }),
        401: errorResponse('Authentication is required.')
      }
    })
  },
  '/api/auth/logout': {
    post: bearerOperation({
      operationId: 'logoutRelayAuthSession',
      summary: 'Revoke the current Relay login session',
      tags: ['Auth'],
      responses: {
        200: jsonResponse('Logout result.', {
          type: 'object',
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' }
          }
        })
      }
    })
  }
})

const buildProfilePaths = () => ({
  '/api/profile/security': {
    get: bearerOperation({
      operationId: 'getRelayProfileSecurity',
      summary: 'Read current account security settings',
      tags: ['Profile security'],
      responses: {
        200: jsonResponse('Current account security summary.', {
          $ref: '#/components/schemas/RelayProfileSecuritySummary'
        }),
        401: errorResponse('A Relay login session or API access token is required.')
      }
    })
  },
  '/api/profile/access-tokens': {
    post: bearerOperation({
      operationId: 'createRelayProfileAccessToken',
      summary: 'Create an API access token for the current account',
      tags: ['Profile security'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayProfileAccessTokenCreate' }),
      responses: {
        200: jsonResponse('Created token metadata and one-time full token value.', {
          $ref: '#/components/schemas/RelayProfileAccessTokenCreateResponse'
        }),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('API access tokens cannot create more access tokens.')
      }
    })
  },
  '/api/profile/access-tokens/{tokenId}': {
    patch: bearerOperation({
      operationId: 'updateRelayProfileAccessToken',
      summary: 'Update a current-account API access token permission grant',
      tags: ['Profile security'],
      parameters: [pathIdParameter('tokenId', 'API access token id.')],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayProfileAccessTokenUpdate' }),
      responses: {
        200: jsonResponse('Updated token metadata.', {
          type: 'object',
          required: ['token'],
          properties: {
            token: { $ref: '#/components/schemas/RelayProfileAccessToken' }
          }
        }),
        400: errorResponse('The permission group grant is invalid.'),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('API access tokens cannot update access tokens.'),
        404: errorResponse('The access token was not found.')
      }
    }),
    delete: bearerOperation({
      operationId: 'revokeRelayProfileAccessToken',
      summary: 'Revoke an API access token owned by the current account',
      tags: ['Profile security'],
      parameters: [pathIdParameter('tokenId', 'API access token id.')],
      responses: {
        200: jsonResponse('Revoked token metadata.', {
          type: 'object',
          required: ['revoked', 'token'],
          properties: {
            revoked: { type: 'boolean' },
            token: { $ref: '#/components/schemas/RelayProfileAccessToken' }
          }
        }),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('API access tokens cannot revoke access tokens.'),
        404: errorResponse('The access token was not found.')
      }
    })
  },
  '/api/profile/account': {
    delete: bearerOperation({
      operationId: 'deleteRelayProfileAccount',
      summary: 'Delete the current Relay account',
      description:
        'Deletes the authenticated current account and removes its sessions, API access tokens, passkeys, devices, team memberships, user-targeted assignments, and profile audit entries. A Relay login session token or a current-user API access token may call this endpoint.',
      tags: ['Profile security'],
      responses: {
        200: jsonResponse('Deleted current account.', {
          type: 'object',
          required: ['deleted', 'userId'],
          properties: {
            deleted: { type: 'boolean' },
            userId: { type: 'string' }
          }
        }),
        401: errorResponse('A Relay login session token or current-user API access token is required.')
      }
    })
  },
  '/api/profile/openapi-audit': {
    get: bearerOperation({
      operationId: 'listRelayProfileOpenApiAuditEvents',
      summary: 'List OpenAPI calls made through current-account API access tokens',
      tags: ['Profile security'],
      parameters: [
        {
          in: 'query',
          name: 'key',
          schema: { type: 'string' },
          description: 'Filter by token id or token preview.'
        },
        {
          in: 'query',
          name: 'path',
          schema: { type: 'string' },
          description: 'Filter by API path substring.'
        },
        {
          in: 'query',
          name: 'status',
          schema: { type: 'string' },
          description: 'Filter by HTTP status code, `success`, or `failure`.'
        },
        {
          in: 'query',
          name: 'from',
          schema: { type: 'string', format: 'date-time' },
          description: 'Only include events created at or after this timestamp.'
        },
        {
          in: 'query',
          name: 'to',
          schema: { type: 'string', format: 'date-time' },
          description: 'Only include events created at or before this timestamp.'
        }
      ],
      responses: {
        200: jsonResponse('OpenAPI audit events for current-account API access tokens.', {
          type: 'object',
          required: ['events'],
          properties: {
            events: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelayOpenApiAuditEvent' }
            }
          }
        }),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('API access tokens cannot read audit history.')
      }
    })
  },
  '/api/profile/password': {
    post: bearerOperation({
      operationId: 'changeRelayProfilePassword',
      summary: 'Set or change the current account password',
      tags: ['Profile security'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayProfilePasswordChange' }),
      responses: {
        200: jsonResponse('Password state.', {
          type: 'object',
          required: ['password'],
          properties: {
            password: {
              type: 'object',
              required: ['enabled'],
              properties: {
                enabled: { type: 'boolean' }
              }
            }
          }
        }),
        400: errorResponse('The password does not satisfy policy.'),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('The current password is invalid or the caller is not a login session.')
      }
    })
  },
  '/api/profile/passkeys/register/options': {
    post: bearerOperation({
      operationId: 'createRelayProfilePasskeyOptions',
      summary: 'Create passkey registration options for the current account',
      tags: ['Profile security'],
      responses: {
        200: jsonResponse('WebAuthn registration options.', {
          $ref: '#/components/schemas/RelayProfilePasskeyOptions'
        }),
        401: errorResponse('A Relay login session is required.'),
        403: errorResponse('The caller is not a login session.'),
        404: errorResponse('Passkey registration is disabled.')
      }
    })
  },
  '/api/profile/passkeys/register/verify': {
    post: bearerOperation({
      operationId: 'verifyRelayProfilePasskey',
      summary: 'Verify and store a new passkey for the current account',
      tags: ['Profile security'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayProfilePasskeyVerify' }),
      responses: {
        200: jsonResponse('Updated passkey summary.', {
          type: 'object',
          additionalProperties: true
        }),
        400: errorResponse('The passkey response is missing or expired.'),
        401: errorResponse('A Relay login session is required or registration verification failed.'),
        403: errorResponse('The caller is not a login session.'),
        404: errorResponse('Passkey registration is disabled.')
      }
    })
  }
})

const teamManagementPaths = (prefix: '/api/admin' | '/api/relay', scope: 'Admin' | 'User') => {
  const teamTag = scope === 'Admin' ? 'Admin teams' : 'User teams'
  const configTag = scope === 'Admin' ? 'Admin configuration' : 'User configuration'
  const policyTag = scope === 'Admin' ? 'Admin team policy' : 'User team policy'
  const messageTag = 'Admin messages'
  const teamId = pathIdParameter('teamId', 'Relay team id or slug.')
  const accessGroupId = pathIdParameter('accessGroupId', 'Relay access group id.')
  const memberId = pathIdParameter('memberId', 'Relay team member id.')
  const profileId = pathIdParameter('profileId', 'Relay configuration profile id.')
  const assignmentId = pathIdParameter('assignmentId', 'Relay configuration assignment id.')
  const secretId = pathIdParameter('secretId', 'Relay configuration secret id.')

  return {
    [`${prefix}/team-policy`]: {
      get: bearerOperation({
        operationId: `getRelay${scope}TeamPolicy`,
        summary: 'Read the Relay team policy',
        tags: [policyTag],
        responses: {
          200: jsonResponse('Relay team policy.', {
            type: 'object',
            required: ['policy'],
            properties: {
              policy: { $ref: '#/components/schemas/RelayTeamPolicy' }
            }
          }),
          ...adminAuthResponses
        }
      }),
      ...(scope === 'Admin'
        ? {
          patch: bearerOperation({
            operationId: 'updateRelayAdminTeamPolicy',
            summary: 'Update the Relay team policy',
            tags: [policyTag],
            requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamPolicyPatch' }),
            responses: {
              200: jsonResponse('Updated Relay team policy.', {
                type: 'object',
                required: ['policy'],
                properties: {
                  policy: { $ref: '#/components/schemas/RelayTeamPolicy' }
                }
              }),
              ...adminAuthResponses,
              400: errorResponse('The policy update is invalid.')
            }
          })
        }
        : {})
    },
    [`${prefix}/teams`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}Teams`,
        summary: 'List visible Relay teams',
        tags: [teamTag],
        responses: {
          200: jsonResponse('Visible Relay teams.', {
            type: 'object',
            required: ['policy', 'teams'],
            properties: {
              policy: { $ref: '#/components/schemas/RelayTeamPolicy' },
              teams: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayTeam' }
              }
            }
          }),
          ...adminAuthResponses
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}Team`,
        summary: 'Create a Relay team',
        tags: [teamTag],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamInput' }),
        responses: {
          200: jsonResponse('Created Relay team.', {
            type: 'object',
            required: ['team'],
            properties: {
              team: { $ref: '#/components/schemas/RelayTeam' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses
        }
      })
    },
    [`${prefix}/teams/{teamId}`]: {
      get: bearerOperation({
        operationId: `getRelay${scope}Team`,
        summary: 'Read a Relay team',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team detail.', {
            type: 'object',
            required: ['team'],
            properties: {
              team: { $ref: '#/components/schemas/RelayTeam' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      patch: bearerOperation({
        operationId: `updateRelay${scope}Team`,
        summary: 'Update a Relay team',
        tags: [teamTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamInput' }),
        responses: {
          200: jsonResponse('Updated Relay team.', {
            type: 'object',
            required: ['team'],
            properties: {
              team: { $ref: '#/components/schemas/RelayTeam' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/archive`]: {
      post: bearerOperation({
        operationId: `archiveRelay${scope}Team`,
        summary: 'Archive a Relay team',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Archived Relay team.', {
            type: 'object',
            required: ['team'],
            properties: {
              team: { $ref: '#/components/schemas/RelayTeam' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/restore`]: {
      post: bearerOperation({
        operationId: `restoreRelay${scope}Team`,
        summary: 'Restore an archived Relay team',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Restored Relay team.', {
            type: 'object',
            required: ['team'],
            properties: {
              team: { $ref: '#/components/schemas/RelayTeam' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/audit-events`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamAuditEvents`,
        summary: 'List recent audit events for a Relay team',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team audit events.', {
            type: 'object',
            required: ['events'],
            properties: {
              events: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayAuditEvent' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/access-groups`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamAccessGroups`,
        summary: 'List Relay team member access groups',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team member access groups.', {
            type: 'object',
            required: ['groups'],
            properties: {
              groups: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayAccessGroup' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}TeamAccessGroup`,
        summary: 'Create a Relay team member access group',
        tags: [teamTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayAccessGroupInput' }),
        responses: {
          200: jsonResponse('Created Relay team member access group.', {
            type: 'object',
            required: ['group'],
            properties: {
              group: { $ref: '#/components/schemas/RelayAccessGroup' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/access-groups/{accessGroupId}`]: {
      patch: bearerOperation({
        operationId: `updateRelay${scope}TeamAccessGroup`,
        summary: 'Update a Relay team member access group',
        tags: [teamTag],
        parameters: [teamId, accessGroupId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayAccessGroupInput' }),
        responses: {
          200: jsonResponse('Updated Relay team member access group.', {
            type: 'object',
            required: ['group'],
            properties: {
              group: { $ref: '#/components/schemas/RelayAccessGroup' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team or access group was not found.')
        }
      }),
      delete: bearerOperation({
        operationId: `deleteRelay${scope}TeamAccessGroup`,
        summary: 'Delete a Relay team member access group',
        tags: [teamTag],
        parameters: [teamId, accessGroupId],
        responses: {
          200: jsonResponse('Deleted Relay team member access group.', {
            type: 'object',
            required: ['deleted', 'group'],
            properties: {
              deleted: { type: 'boolean' },
              group: { $ref: '#/components/schemas/RelayAccessGroup' }
            }
          }),
          ...adminAuthResponses,
          403: errorResponse('The group is built-in, the owner group, or cannot be changed by the caller.'),
          404: errorResponse('The team or access group was not found.'),
          409: errorResponse('The access group is still assigned or used as a parent.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/members`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamMembers`,
        summary: 'List Relay team members',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team members.', {
            type: 'object',
            required: ['members'],
            properties: {
              members: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayTeamMember' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}TeamMember`,
        summary: 'Add a Relay team member',
        tags: [teamTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamMemberInput' }),
        responses: {
          200: jsonResponse('Created Relay team member.', {
            type: 'object',
            required: ['member'],
            properties: {
              member: { $ref: '#/components/schemas/RelayTeamMember' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team or user was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/members/{memberId}`]: {
      patch: bearerOperation({
        operationId: `updateRelay${scope}TeamMember`,
        summary: 'Update a Relay team member',
        tags: [teamTag],
        parameters: [teamId, memberId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamMemberInput' }),
        responses: {
          200: jsonResponse('Updated Relay team member.', {
            type: 'object',
            required: ['member'],
            properties: {
              member: { $ref: '#/components/schemas/RelayTeamMember' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The member was not found.')
        }
      }),
      delete: bearerOperation({
        operationId: `deleteRelay${scope}TeamMember`,
        summary: 'Remove a Relay team member',
        tags: [teamTag],
        parameters: [teamId, memberId],
        responses: {
          200: jsonResponse('Removed Relay team member.', {
            type: 'object',
            required: ['deleted', 'member'],
            properties: {
              deleted: { type: 'boolean' },
              member: { $ref: '#/components/schemas/RelayTeamMember' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The member was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/invitations`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamInvitations`,
        summary: 'List Relay team invitations',
        tags: [teamTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team invitations.', {
            type: 'object',
            required: ['invitations'],
            properties: {
              invitations: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayTeamInvitation' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}TeamInvitation`,
        summary: 'Create a Relay team invitation',
        tags: [teamTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamMemberInput' }),
        responses: {
          200: jsonResponse('Created Relay team invitation.', {
            type: 'object',
            required: ['invitation'],
            properties: {
              invitation: { $ref: '#/components/schemas/RelayTeamInvitation' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team or invitee was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/config-profiles`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamConfigProfiles`,
        summary: 'List configuration profiles for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay configuration profiles.', {
            type: 'object',
            required: ['profiles'],
            properties: {
              profiles: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayConfigProfile' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}TeamConfigProfile`,
        summary: 'Create a configuration profile for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigProfileInput' }),
        responses: {
          200: jsonResponse('Created configuration profile.', {
            type: 'object',
            required: ['profile'],
            properties: {
              profile: { $ref: '#/components/schemas/RelayConfigProfile' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/documents`]: {
      get: bearerOperation({
        operationId: `getRelay${scope}TeamDocuments`,
        summary: 'Read encrypted instruction document snapshot metadata for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay team document snapshot.', {
            $ref: '#/components/schemas/RelayTeamDocumentSnapshotResponse'
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      put: bearerOperation({
        operationId: `updateRelay${scope}TeamDocuments`,
        summary: 'Update encrypted instruction documents for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayTeamDocumentUpdate' }),
        responses: {
          200: jsonResponse('Updated Relay team document snapshot.', {
            $ref: '#/components/schemas/RelayTeamDocumentSnapshotResponse'
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/config-profiles/{profileId}`]: {
      get: bearerOperation({
        operationId: `getRelay${scope}ConfigProfile`,
        summary: 'Read a Relay configuration profile',
        tags: [configTag],
        parameters: [profileId],
        responses: {
          200: jsonResponse('Relay configuration profile detail.', {
            type: 'object',
            additionalProperties: true
          }),
          ...adminAuthResponses,
          404: errorResponse('The configuration profile was not found.')
        }
      }),
      patch: bearerOperation({
        operationId: `updateRelay${scope}ConfigProfile`,
        summary: 'Update a Relay configuration profile',
        tags: [configTag],
        parameters: [profileId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigProfileInput' }),
        responses: {
          200: jsonResponse('Updated configuration profile.', {
            type: 'object',
            required: ['profile'],
            properties: {
              profile: { $ref: '#/components/schemas/RelayConfigProfile' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The configuration profile was not found.')
        }
      })
    },
    [`${prefix}/config-profiles/{profileId}/versions`]: {
      post: bearerOperation({
        operationId: `createRelay${scope}ConfigProfileVersion`,
        summary: 'Create a new configuration profile version',
        tags: [configTag],
        parameters: [profileId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigProfileVersionInput' }),
        responses: {
          200: jsonResponse('Created configuration profile version.', {
            type: 'object',
            additionalProperties: true
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The configuration profile was not found.')
        }
      })
    },
    [`${prefix}/config-profiles/{profileId}/publish`]: {
      post: bearerOperation({
        operationId: `publishRelay${scope}ConfigProfile`,
        summary: 'Publish a configuration profile version',
        tags: [configTag],
        parameters: [profileId],
        responses: {
          200: jsonResponse('Published configuration profile.', {
            type: 'object',
            additionalProperties: true
          }),
          ...adminAuthResponses,
          404: errorResponse('The configuration profile was not found.')
        }
      })
    },
    [`${prefix}/config-profiles/{profileId}/assignments`]: {
      post: bearerOperation({
        operationId: `createRelay${scope}ConfigProfileAssignment`,
        summary: 'Create a configuration profile assignment',
        tags: [configTag],
        parameters: [profileId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigAssignmentInput' }),
        responses: {
          200: jsonResponse('Created configuration profile assignment.', {
            type: 'object',
            additionalProperties: true
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The configuration profile was not found.')
        }
      })
    },
    [`${prefix}/config-assignments/{assignmentId}`]: {
      patch: bearerOperation({
        operationId: `updateRelay${scope}ConfigAssignment`,
        summary: 'Update a configuration profile assignment',
        tags: [configTag],
        parameters: [assignmentId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigAssignmentInput' }),
        responses: {
          200: jsonResponse('Updated configuration profile assignment.', {
            type: 'object',
            additionalProperties: true
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The configuration assignment was not found.')
        }
      })
    },
    [`${prefix}/teams/{teamId}/config-secrets`]: {
      get: bearerOperation({
        operationId: `listRelay${scope}TeamConfigSecrets`,
        summary: 'List redacted configuration secrets for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        responses: {
          200: jsonResponse('Relay configuration secrets.', {
            type: 'object',
            required: ['secrets'],
            properties: {
              secrets: {
                type: 'array',
                items: { $ref: '#/components/schemas/RelayConfigSecret' }
              }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The team was not found.')
        }
      }),
      post: bearerOperation({
        operationId: `createRelay${scope}TeamConfigSecret`,
        summary: 'Create a device-encrypted configuration secret for a Relay team',
        tags: [configTag],
        parameters: [teamId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigSecretInput' }),
        responses: {
          200: jsonResponse('Created configuration secret metadata.', {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: { $ref: '#/components/schemas/RelayConfigSecret' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The team was not found.')
        }
      })
    },
    [`${prefix}/config-secrets/{secretId}`]: {
      get: bearerOperation({
        operationId: `getRelay${scope}ConfigSecret`,
        summary: 'Read redacted configuration secret metadata',
        tags: [configTag],
        parameters: [secretId],
        responses: {
          200: jsonResponse('Configuration secret metadata.', {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: { $ref: '#/components/schemas/RelayConfigSecret' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The configuration secret was not found.')
        }
      })
    },
    [`${prefix}/config-secrets/{secretId}/rotate`]: {
      post: bearerOperation({
        operationId: `rotateRelay${scope}ConfigSecret`,
        summary: 'Rotate a configuration secret value',
        tags: [configTag],
        parameters: [secretId],
        requestBody: requestBody({ $ref: '#/components/schemas/RelayConfigSecretRotate' }),
        responses: {
          200: jsonResponse('Rotated configuration secret metadata.', {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: { $ref: '#/components/schemas/RelayConfigSecret' }
            }
          }),
          ...adminAuthResponses,
          ...validationResponses,
          404: errorResponse('The configuration secret was not found.')
        }
      })
    },
    [`${prefix}/config-secrets/{secretId}/revoke`]: {
      post: bearerOperation({
        operationId: `revokeRelay${scope}ConfigSecret`,
        summary: 'Revoke a configuration secret',
        tags: [configTag],
        parameters: [secretId],
        responses: {
          200: jsonResponse('Revoked configuration secret metadata.', {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: { $ref: '#/components/schemas/RelayConfigSecret' }
            }
          }),
          ...adminAuthResponses,
          404: errorResponse('The configuration secret was not found.')
        }
      })
    },
    ...(scope === 'Admin'
      ? {
        [`${prefix}/team-invitations/{invitationId}/accept`]: {
          post: bearerOperation({
            operationId: 'acceptRelayAdminTeamInvitation',
            summary: 'Accept a Relay team invitation',
            tags: [teamTag],
            parameters: [pathIdParameter('invitationId', 'Relay team invitation id.')],
            responses: {
              200: jsonResponse('Accepted team invitation.', {
                type: 'object',
                additionalProperties: true
              }),
              ...adminAuthResponses,
              404: errorResponse('The team invitation was not found.'),
              409: errorResponse('The team invitation is no longer pending.')
            }
          })
        },
        [`${prefix}/team-invitations/{invitationId}/decline`]: {
          post: bearerOperation({
            operationId: 'declineRelayAdminTeamInvitation',
            summary: 'Decline a Relay team invitation',
            tags: [teamTag],
            parameters: [pathIdParameter('invitationId', 'Relay team invitation id.')],
            responses: {
              200: jsonResponse('Declined team invitation.', {
                type: 'object',
                required: ['invitation'],
                properties: {
                  invitation: { $ref: '#/components/schemas/RelayTeamInvitation' }
                }
              }),
              ...adminAuthResponses,
              404: errorResponse('The team invitation was not found.'),
              409: errorResponse('The team invitation is no longer pending.')
            }
          })
        },
        [`${prefix}/messages`]: {
          get: bearerOperation({
            operationId: 'listRelayAdminMessages',
            summary: 'List visible Relay admin messages',
            tags: [messageTag],
            responses: {
              200: jsonResponse('Relay messages.', {
                type: 'object',
                required: ['messages'],
                properties: {
                  messages: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/RelayMessage' }
                  }
                }
              }),
              ...adminAuthResponses
            }
          }),
          post: bearerOperation({
            operationId: 'createRelayAdminMessage',
            summary: 'Create a Relay admin message',
            tags: [messageTag],
            requestBody: requestBody({ $ref: '#/components/schemas/RelayMessageInput' }),
            responses: {
              200: jsonResponse('Created Relay message.', {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { $ref: '#/components/schemas/RelayMessage' }
                }
              }),
              ...adminAuthResponses,
              ...validationResponses
            }
          })
        }
      }
      : {})
  }
}

const buildRelayUserPaths = () => ({
  '/api/relay/config/global': {
    get: bearerOperation({
      operationId: 'getRelayPersonalGlobalConfig',
      summary: 'Read the personal global configuration snapshot for the current user',
      tags: ['User configuration'],
      responses: {
        200: jsonResponse('Personal global configuration snapshot.', {
          $ref: '#/components/schemas/RelayPersonalConfigSnapshotResponse'
        }),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('The caller cannot read personal configuration snapshots.')
      }
    }),
    put: bearerOperation({
      operationId: 'updateRelayPersonalGlobalConfig',
      summary: 'Update the personal global configuration snapshot for the current user',
      tags: ['User configuration'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayPersonalConfigUpdate' }),
      responses: {
        200: jsonResponse('Updated personal global configuration snapshot.', {
          $ref: '#/components/schemas/RelayPersonalConfigSnapshotResponse'
        }),
        400: errorResponse('A safe configuration patch is required.'),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('The caller cannot write personal configuration snapshots.'),
        409: errorResponse('The personal configuration snapshot has changed on the server.')
      }
    })
  },
  '/api/relay/config-snapshot': {
    get: bearerOperation({
      operationId: 'getRelayUserConfigSnapshot',
      summary: 'Read the effective managed configuration snapshot for the current user',
      tags: ['User configuration'],
      parameters: [
        {
          in: 'query',
          name: 'cwd',
          required: false,
          schema: { type: 'string' }
        },
        {
          in: 'query',
          name: 'projectId',
          required: false,
          schema: { type: 'string' }
        },
        {
          in: 'query',
          name: 'workspaceFolder',
          required: false,
          schema: { type: 'string' }
        }
      ],
      responses: {
        200: jsonResponse('Effective Relay configuration snapshot.', {
          $ref: '#/components/schemas/RelayConfigSnapshot'
        }),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('The caller cannot read configuration snapshots.')
      }
    })
  },
  ...teamManagementPaths('/api/relay', 'User')
})

const buildAdminPaths = () => ({
  ...teamManagementPaths('/api/admin', 'Admin'),
  '/api/admin/access-groups': {
    get: bearerOperation({
      operationId: 'listRelayAdminAccessGroups',
      summary: 'List platform access groups',
      tags: ['Admin access groups'],
      responses: {
        200: jsonResponse('Platform access groups.', {
          type: 'object',
          required: ['groups'],
          properties: {
            groups: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelayAccessGroup' }
            }
          }
        }),
        ...adminAuthResponses
      }
    }),
    post: bearerOperation({
      operationId: 'createRelayAdminAccessGroup',
      summary: 'Create a platform access group',
      tags: ['Admin access groups'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAccessGroupInput' }),
      responses: {
        200: jsonResponse('Created platform access group.', {
          type: 'object',
          required: ['group'],
          properties: {
            group: { $ref: '#/components/schemas/RelayAccessGroup' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses
      }
    })
  },
  '/api/admin/access-groups/{accessGroupId}': {
    patch: bearerOperation({
      operationId: 'updateRelayAdminAccessGroup',
      summary: 'Update a platform access group',
      tags: ['Admin access groups'],
      parameters: [pathIdParameter('accessGroupId', 'Relay platform access group id.')],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAccessGroupInput' }),
      responses: {
        200: jsonResponse('Updated platform access group.', {
          type: 'object',
          required: ['group'],
          properties: {
            group: { $ref: '#/components/schemas/RelayAccessGroup' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses,
        404: errorResponse('The access group was not found.')
      }
    }),
    delete: bearerOperation({
      operationId: 'deleteRelayAdminAccessGroup',
      summary: 'Delete a platform access group',
      tags: ['Admin access groups'],
      parameters: [pathIdParameter('accessGroupId', 'Relay platform access group id.')],
      responses: {
        200: jsonResponse('Deleted platform access group.', {
          type: 'object',
          required: ['deleted', 'group'],
          properties: {
            deleted: { type: 'boolean' },
            group: { $ref: '#/components/schemas/RelayAccessGroup' }
          }
        }),
        ...adminAuthResponses,
        403: errorResponse('The group is built-in, the owner group, or cannot be changed by the caller.'),
        404: errorResponse('The access group was not found.'),
        409: errorResponse('The access group is still assigned or used as a parent.')
      }
    })
  },
  '/api/admin/users': {
    get: bearerOperation({
      operationId: 'listRelayAdminUsers',
      summary: 'List Relay users',
      tags: ['Admin users'],
      responses: {
        200: jsonResponse('Relay users.', {
          type: 'object',
          required: ['users'],
          properties: {
            users: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelayAdminUser' }
            }
          }
        }),
        ...adminAuthResponses
      }
    }),
    post: bearerOperation({
      operationId: 'createRelayAdminUser',
      summary: 'Create a non-SSO Relay user',
      tags: ['Admin users'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminUserCreate' }),
      responses: {
        200: jsonResponse('Created user.', {
          type: 'object',
          required: ['user'],
          properties: {
            user: { $ref: '#/components/schemas/RelayAdminUser' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses
      }
    }),
    patch: bearerOperation({
      operationId: 'updateRelayAdminUser',
      summary: 'Update a Relay user by body id or email lookup',
      tags: ['Admin users'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminUserPatch' }),
      responses: {
        200: jsonResponse('Updated user.', {
          type: 'object',
          required: ['user'],
          properties: {
            user: { $ref: '#/components/schemas/RelayAdminUser' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses,
        404: errorResponse('The target user was not found.')
      }
    })
  },
  '/api/admin/users/{userId}': {
    patch: bearerOperation({
      operationId: 'updateRelayAdminUserById',
      summary: 'Update a Relay user by id',
      tags: ['Admin users'],
      parameters: [pathIdParameter('userId', 'Relay user id.')],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminUserPatch' }),
      responses: {
        200: jsonResponse('Updated user.', {
          type: 'object',
          required: ['user'],
          properties: {
            user: { $ref: '#/components/schemas/RelayAdminUser' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses,
        404: errorResponse('The target user was not found.')
      }
    })
  },
  '/api/admin/invites': {
    get: bearerOperation({
      operationId: 'listRelayAdminInvites',
      summary: 'List Relay invite codes',
      tags: ['Admin invites'],
      responses: {
        200: jsonResponse('Relay invite codes.', {
          type: 'object',
          required: ['invites'],
          properties: {
            invites: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelayAdminInvite' }
            }
          }
        }),
        ...adminAuthResponses
      }
    }),
    post: bearerOperation({
      operationId: 'createRelayAdminInvite',
      summary: 'Create a Relay invite code',
      tags: ['Admin invites'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminInviteCreate' }),
      responses: {
        200: jsonResponse('Created invite.', {
          type: 'object',
          required: ['invite'],
          properties: {
            invite: { $ref: '#/components/schemas/RelayAdminInvite' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses
      }
    }),
    patch: bearerOperation({
      operationId: 'updateRelayAdminInvite',
      summary: 'Update or revoke a Relay invite by body code',
      tags: ['Admin invites'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminInvitePatch' }),
      responses: {
        200: jsonResponse('Updated invite.', {
          type: 'object',
          required: ['invite'],
          properties: {
            invite: { $ref: '#/components/schemas/RelayAdminInvite' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses,
        404: errorResponse('The target invite was not found.')
      }
    }),
    delete: bearerOperation({
      operationId: 'deleteRelayAdminInvite',
      summary: 'Delete a Relay invite by query or body code',
      tags: ['Admin invites'],
      parameters: [{
        in: 'query',
        name: 'code',
        required: false,
        schema: { type: 'string' },
        description: 'Invite code. If omitted, Relay also accepts a JSON body with `code`.'
      }],
      responses: {
        200: jsonResponse('Deleted invite.', {
          type: 'object',
          required: ['deleted', 'invite'],
          properties: {
            deleted: { type: 'boolean' },
            invite: { $ref: '#/components/schemas/RelayAdminInvite' }
          }
        }),
        ...adminAuthResponses,
        400: errorResponse('Invite code is required.'),
        404: errorResponse('The target invite was not found.')
      }
    })
  },
  '/api/admin/invites/{code}': {
    patch: bearerOperation({
      operationId: 'updateRelayAdminInviteByCode',
      summary: 'Update or revoke a Relay invite by code',
      tags: ['Admin invites'],
      parameters: [pathIdParameter('code', 'Relay invite code.')],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminInvitePatch' }),
      responses: {
        200: jsonResponse('Updated invite.', {
          type: 'object',
          required: ['invite'],
          properties: {
            invite: { $ref: '#/components/schemas/RelayAdminInvite' }
          }
        }),
        ...adminAuthResponses,
        ...validationResponses,
        404: errorResponse('The target invite was not found.')
      }
    }),
    delete: bearerOperation({
      operationId: 'deleteRelayAdminInviteByCode',
      summary: 'Delete a Relay invite by code',
      tags: ['Admin invites'],
      parameters: [pathIdParameter('code', 'Relay invite code.')],
      responses: {
        200: jsonResponse('Deleted invite.', {
          type: 'object',
          required: ['deleted', 'invite'],
          properties: {
            deleted: { type: 'boolean' },
            invite: { $ref: '#/components/schemas/RelayAdminInvite' }
          }
        }),
        ...adminAuthResponses,
        404: errorResponse('The target invite was not found.')
      }
    })
  },
  '/api/admin/sso-providers': {
    get: bearerOperation({
      operationId: 'listRelayAdminSsoProviders',
      summary: 'List managed SSO providers',
      tags: ['Admin SSO providers'],
      responses: {
        200: jsonResponse('Managed SSO providers with redacted secrets.', {
          type: 'object',
          required: ['providers'],
          properties: {
            providers: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelayAdminSsoProvider' }
            }
          }
        }),
        ...adminAuthResponses
      }
    }),
    post: bearerOperation({
      operationId: 'createRelayAdminSsoProvider',
      summary: 'Create a managed SSO provider',
      tags: ['Admin SSO providers'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminSsoProviderInput' }),
      responses: {
        200: jsonResponse('Created provider with redacted secret.', {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { $ref: '#/components/schemas/RelayAdminSsoProvider' }
          }
        }),
        ...adminAuthResponses,
        400: errorResponse('The provider configuration is invalid.')
      }
    })
  },
  '/api/admin/sso-providers/{providerId}': {
    get: bearerOperation({
      operationId: 'getRelayAdminSsoProvider',
      summary: 'Read one managed SSO provider',
      tags: ['Admin SSO providers'],
      parameters: [pathIdParameter('providerId', 'Managed SSO provider id.')],
      responses: {
        200: jsonResponse('Provider detail with redacted secret.', {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { $ref: '#/components/schemas/RelayAdminSsoProvider' }
          }
        }),
        ...adminAuthResponses,
        404: errorResponse('The target provider was not found.')
      }
    }),
    patch: bearerOperation({
      operationId: 'updateRelayAdminSsoProvider',
      summary: 'Update one managed SSO provider',
      tags: ['Admin SSO providers'],
      parameters: [pathIdParameter('providerId', 'Managed SSO provider id.')],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayAdminSsoProviderPatch' }),
      responses: {
        200: jsonResponse('Updated provider with redacted secret.', {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { $ref: '#/components/schemas/RelayAdminSsoProvider' }
          }
        }),
        ...adminAuthResponses,
        400: errorResponse('The provider configuration is invalid.'),
        404: errorResponse('The target provider was not found.')
      }
    }),
    delete: bearerOperation({
      operationId: 'deleteRelayAdminSsoProvider',
      summary: 'Delete one managed SSO provider',
      tags: ['Admin SSO providers'],
      parameters: [pathIdParameter('providerId', 'Managed SSO provider id.')],
      responses: {
        200: jsonResponse('Deleted provider with redacted secret.', {
          type: 'object',
          required: ['deleted', 'provider'],
          properties: {
            deleted: { type: 'boolean' },
            provider: { $ref: '#/components/schemas/RelayAdminSsoProvider' }
          }
        }),
        ...adminAuthResponses,
        404: errorResponse('The target provider was not found.')
      }
    })
  },
  '/api/admin/security/tokens/rotate': {
    post: bearerOperation({
      operationId: 'rotateRelayAdminTokenTarget',
      summary: 'Rotate a Relay session or device token',
      tags: ['Admin security'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayTokenOperationInput' }),
      responses: {
        200: jsonResponse('Token rotation result.', {
          $ref: '#/components/schemas/RelayTokenOperationResult'
        }),
        ...adminAuthResponses,
        400: errorResponse('Token kind or target is invalid.'),
        404: errorResponse('The target token was not found.'),
        409: errorResponse('The requested token kind cannot be rotated through this API.')
      }
    })
  },
  '/api/admin/security/tokens/revoke': {
    post: bearerOperation({
      operationId: 'revokeRelayAdminTokenTarget',
      summary: 'Revoke a Relay session or device token',
      tags: ['Admin security'],
      requestBody: requestBody({ $ref: '#/components/schemas/RelayTokenOperationInput' }),
      responses: {
        200: jsonResponse('Token revocation result.', {
          $ref: '#/components/schemas/RelayTokenOperationResult'
        }),
        ...adminAuthResponses,
        400: errorResponse('Token kind or target is invalid.'),
        404: errorResponse('The target token was not found.'),
        409: errorResponse('The requested token kind cannot be revoked through this API.')
      }
    })
  },
  '/api/relay/metrics': {
    get: bearerOperation({
      operationId: 'getRelayAdminMetrics',
      summary: 'Read Relay metrics and recent trace metadata',
      tags: ['Admin metrics'],
      responses: {
        200: jsonResponse('Relay metrics snapshot.', {
          $ref: '#/components/schemas/RelayMetricsSnapshot'
        }),
        ...adminAuthResponses
      }
    })
  }
})

interface RelayOpenApiDocumentOptions {
  bearerFormat: string
  description: string
  paths: JsonObject
  schemaNames: string[]
  tags: JsonObject[]
  title: string
}

const buildRelayOpenApiDocument = (baseUrl: string, options: RelayOpenApiDocumentOptions) => ({
  openapi: '3.1.0',
  info: {
    title: options.title,
    version: VERSION,
    description: options.description
  },
  servers: [{
    url: baseUrl,
    description: 'Current Relay origin'
  }],
  tags: options.tags,
  components: buildComponents(options.bearerFormat, new Set(options.schemaNames)),
  paths: options.paths
})

const commonTags = [
  { name: 'OpenAPI', description: 'Machine-readable API contract.' },
  { name: 'System', description: 'Public Relay service discovery.' },
  { name: 'Auth', description: 'Relay login session discovery and logout.' }
]

const commonSchemas = [
  'ErrorResponse',
  'RelayAuthUser',
  'RelayRole'
]

const adminSchemas = [
  ...commonSchemas,
  'RelayAccessGroup',
  'RelayAccessGroupInput',
  'RelayAuditEvent',
  'RelayAdminInvite',
  'RelayAdminInviteCreate',
  'RelayAdminInvitePatch',
  'RelayAdminSsoProvider',
  'RelayAdminSsoProviderInput',
  'RelayAdminSsoProviderPatch',
  'RelayAdminUser',
  'RelayAdminUserCreate',
  'RelayAdminUserPatch',
  'RelayConfigAssignment',
  'RelayConfigAssignmentInput',
  'RelayConfigProfile',
  'RelayConfigProfileInput',
  'RelayConfigProfileVersionInput',
  'RelayConfigSecret',
  'RelayConfigSecretInput',
  'RelayConfigSecretRotate',
  'RelayEncryptedPayload',
  'RelayMessage',
  'RelayMessageInput',
  'RelayMetricsSnapshot',
  'RelayPersonalDocumentCounts',
  'RelayPersonalDocumentSnapshot',
  'RelayTeam',
  'RelayTeamDocumentSnapshot',
  'RelayTeamDocumentSnapshotResponse',
  'RelayTeamDocumentUpdate',
  'RelayTeamInput',
  'RelayTeamInvitation',
  'RelayTeamMember',
  'RelayTeamMemberInput',
  'RelayTeamPolicy',
  'RelayTeamPolicyPatch',
  'RelayTokenOperationInput',
  'RelayTokenOperationKind',
  'RelayTokenOperationResult'
]

const profileSchemas = [
  ...commonSchemas,
  'RelayAccessGroup',
  'RelayAccessGroupInput',
  'RelayAuditEvent',
  'RelayConfigAssignment',
  'RelayConfigAssignmentInput',
  'RelayConfigProfile',
  'RelayConfigProfileInput',
  'RelayConfigProfileVersionInput',
  'RelayConfigSecret',
  'RelayConfigSecretInput',
  'RelayConfigSecretRotate',
  'RelayConfigSnapshot',
  'RelayEncryptedPayload',
  'RelayPersonalConfigSnapshot',
  'RelayPersonalConfigSnapshotResponse',
  'RelayPersonalConfigUpdate',
  'RelayPersonalDocumentCounts',
  'RelayPersonalDocumentSnapshot',
  'RelayProfileAccessToken',
  'RelayProfileAccessTokenCreate',
  'RelayProfileAccessTokenCreateResponse',
  'RelayProfileAccessTokenUpdate',
  'RelayOpenApiAuditEvent',
  'RelayProfilePasswordChange',
  'RelayProfilePasskeyOptions',
  'RelayProfilePasskeyVerify',
  'RelayProfileSecuritySummary',
  'RelayTeam',
  'RelayTeamDocumentSnapshot',
  'RelayTeamDocumentSnapshotResponse',
  'RelayTeamDocumentUpdate',
  'RelayTeamInput',
  'RelayTeamInvitation',
  'RelayTeamMember',
  'RelayTeamMemberInput',
  'RelayTeamPolicy',
  'RelayTeamPolicyPatch'
]

export const buildRelayAdminOpenApiDocument = (baseUrl: string) =>
  buildRelayOpenApiDocument(baseUrl, {
    bearerFormat: 'Deployment admin token, Relay login session token, or user API access token with admin permissions',
    description:
      'Machine-readable REST API contract for OneWorks Relay platform administration. Protected endpoints use `Authorization: Bearer <token>` and require admin permissions.',
    paths: {
      ...buildOpenApiPaths(
        '/api/admin/openapi.json',
        'Read the Relay platform admin OpenAPI document',
        'OpenAPI 3.1 document for Relay platform admin APIs.'
      ),
      ...buildCommonPaths(),
      ...buildAdminPaths()
    },
    schemaNames: adminSchemas,
    tags: [
      ...commonTags,
      { name: 'Admin access groups', description: 'Platform user group capability and quota management.' },
      { name: 'Admin team policy', description: 'Tenant team and managed configuration policy.' },
      { name: 'Admin teams', description: 'Platform team, member, invitation, and audit management.' },
      { name: 'Admin configuration', description: 'Platform managed configuration profiles and secrets.' },
      { name: 'Admin messages', description: 'Platform and team message management.' },
      { name: 'Admin users', description: 'Relay user management.' },
      { name: 'Admin invites', description: 'Relay invite code management.' },
      { name: 'Admin SSO providers', description: 'Managed OAuth/OIDC provider management.' },
      { name: 'Admin security', description: 'Session and device token rotation or revocation.' },
      { name: 'Admin metrics', description: 'Relay metrics and trace metadata.' }
    ],
    title: 'OneWorks Relay Platform Admin API'
  })

export const buildRelayProfileOpenApiDocument = (baseUrl: string) =>
  buildRelayOpenApiDocument(baseUrl, {
    bearerFormat: 'Relay login session token or user API access token',
    description:
      'Machine-readable REST API contract for the current Relay user account. API access token management, password changes, and passkey registration require a normal Relay login session; account deletion also accepts a current-user API access token.',
    paths: {
      ...buildOpenApiPaths(
        '/api/profile/openapi.json',
        'Read the Relay user OpenAPI document',
        'OpenAPI 3.1 document for current-user Relay APIs.'
      ),
      ...buildCommonPaths(),
      ...buildProfilePaths(),
      ...buildRelayUserPaths()
    },
    schemaNames: profileSchemas,
    tags: [
      ...commonTags,
      { name: 'Profile security', description: 'Current-account security and API access token operations.' },
      { name: 'User team policy', description: 'Current-user team and managed configuration policy.' },
      { name: 'User teams', description: 'Current-user team, member, invitation, and audit operations.' },
      {
        name: 'User configuration',
        description: 'Current-user managed configuration profiles, secrets, and snapshots.'
      }
    ],
    title: 'OneWorks Relay User API'
  })

export const handleRelayAdminOpenApi = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs
) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, args)
    return true
  }
  sendJson(res, 200, buildRelayAdminOpenApiDocument(publicRequestBaseUrl(req, args.publicBaseUrl)), args.allowOrigin)
  return true
}

export const handleRelayProfileOpenApi = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs
) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, args)
    return true
  }
  sendJson(res, 200, buildRelayProfileOpenApiDocument(publicRequestBaseUrl(req, args.publicBaseUrl)), args.allowOrigin)
  return true
}
