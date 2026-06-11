import { Form, Input, Modal } from 'antd'
import { useEffect, useState } from 'react'

import type { RelayAdminUser } from '../../shared/model/adminTypes'

interface PasswordFormValues {
  password: string
}

export interface UserPasswordModalProps {
  user?: RelayAdminUser
  onClose: () => void
  onSetPassword: (user: RelayAdminUser, password: string) => Promise<void>
}

export const UserPasswordModal = ({ onClose, onSetPassword, user }: UserPasswordModalProps) => {
  const [passwordForm] = Form.useForm<PasswordFormValues>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (user == null) return
    passwordForm.resetFields()
  }, [passwordForm, user])

  const close = () => {
    if (isSubmitting) return
    onClose()
  }

  const handleSetPassword = async (values: PasswordFormValues) => {
    if (user == null) return
    setIsSubmitting(true)
    try {
      await onSetPassword(user, values.password)
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      destroyOnHidden
      confirmLoading={isSubmitting}
      okText={user?.passwordEnabled === true ? '重置密码' : '设置密码'}
      open={user != null}
      title={user == null ? '设置密码' : `${user.email} 的登录密码`}
      onCancel={close}
      onOk={() => passwordForm.submit()}
    >
      <Form form={passwordForm} layout='vertical' onFinish={handleSetPassword}>
        <Form.Item label='新密码' name='password' rules={[{ min: 8, required: true }]}>
          <Input.Password autoComplete='new-password' disabled={isSubmitting} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
