import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from './authContext'
import { LoginForm } from './LoginForm'

function renderForm(login: (e: string, p: string) => Promise<void>) {
  render(
    <AuthContext.Provider value={{ status: 'anonymous', user: null, login, logout: vi.fn() }}>
      <LoginForm />
    </AuthContext.Provider>,
  )
}

describe('LoginForm', () => {
  it('keeps the button disabled until both fields are filled', async () => {
    renderForm(vi.fn())
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    expect(button).toBeEnabled()
  })

  it('submits the credentials', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    renderForm(login)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(login).toHaveBeenCalledWith('a@b.co', 'secret')
  })

  it('shows the error and clears the password after a failed attempt', async () => {
    renderForm(vi.fn().mockRejectedValue(new Error('invalid email or password')))
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid email or password')
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''))
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.co')
  })

  it('uses the right autocomplete hints so password managers work', () => {
    renderForm(vi.fn())
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})
